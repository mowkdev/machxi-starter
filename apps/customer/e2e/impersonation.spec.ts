import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./support/fixtures";

import {
  ADMIN_URL,
  API_URL,
  CUSTOMER_EMAIL,
  OPERATOR,
  THEME_LABELS,
  assertApiWindowClear,
  choose,
  chosen,
  labelFor,
  signInAsOperator,
  userRefreshToken,
} from "./support/app";

/**
 * The impersonation walk, end to end and in one browser (`D13.9`; ADR-0057,
 * ADR-0052 §The browser tier as ADR-0055 §2 carries it) — **in two tabs since
 * `D17.3`** (ADR-0070).
 *
 * **ADR-0058 is deliberately not in that list.** The settings write below is
 * audited, but 0058 ships no read surface on purpose, so nothing here can read
 * the row back — attribution stays a manual check (the plan's
 * §Definition-of-done item 5) until an `/admin/audit` surface exists.
 *
 * **This is the one claim D13 could not make anywhere else.** Eight steps built
 * the halves and each proved its own at the wire: `D13.4` covers the mint and the
 * exchange in `impersonation.int.test.ts` and `D13.5` the exclusions, the
 * attribution and the revocation in `impersonation-exclusions.int.test.ts`;
 * `D13.7` drives the fragment, the banner and the refusal against MSW; `D13.8`
 * drives the row action, the confirm and the address it builds. What none of
 * them can do is cross the origin: MSW cannot see a `Set-Cookie`, jsdom does not
 * follow a navigation, and supertest has no browser to hold two populations'
 * cookies at once. So the seam between the admin panel and the customer app —
 * the *only* place the feature actually is — was untested until here.
 *
 * **`D17` moved the seam into a second browsing context, which is why this file
 * changed more than any other in that deliverable.** The confirm now opens a
 * blank tab inside the click and navigates it when the mint answers (ADR-0070
 * §1), disowning its opener first (§2). Neither half is visible from jsdom:
 * `D17.2`'s admin suite proves what the dialog *says* to a stub handle, and a
 * `window.opener` that is really absent, a panel that really stays on screen and
 * a second tab that really carries its own session are properties of a browser.
 * They are asserted here and nowhere else.
 *
 * **The second mint is the other half of ADR-0070, and it is the one stage that
 * needs both tabs alive at once** (§4). The user population's cookies are one
 * jar, so a second exchange overwrites the first tab's — and the API ends the
 * impersonated session that cookie named rather than leaving it live behind a
 * tab whose identity has silently changed. What that looks like from the first
 * tab is the assertion below: its next request is refused as
 * `AUTH_SESSION_REVOKED`, which `@repo/api-client` treats as terminal, so the
 * tab signs itself out instead of swapping banners.
 *
 * **It lives in the customer app's suite**, beside `dual-session.spec.ts` and
 * for the same reason: the flow ends on this origin, this suite already owns a
 * spec that signs into both apps, and the admin panel is reached here by its own
 * address rather than by a second Playwright config.
 *
 * **One test, not seven.** Every claim below is a stage of a single episode —
 * a mint that has been spent cannot be spent again, and a session that has been
 * exited cannot be acted in — so splitting them would mean re-minting per test:
 * more of ADR-0057 §1's per-actor budget, more of ADR-0020's window, and a set
 * of tests each of which silently depends on the last. The stages are commented
 * instead, which is what makes a failure legible without making them
 * independent when they are not.
 *
 * **Its own context, not the worker's signed-in `app`.** ADR-0057 §3 says the
 * exchange overwrites whatever this browser was holding, so running the walk in
 * the shared context would end it signed out as somebody else — every later spec
 * in the worker failing on a session this one spent. The default `page` fixture
 * gives a fresh context per test, which is also the honest shape: an operator
 * opening a customer's account is not a customer.
 */

/*
 * `USER_REFRESH_COOKIE` and `userRefreshToken` were written out here at `D13.9`
 * and moved into `support/app.ts` at `D15.8`, when `organizations.spec.ts`
 * became the second spec in this suite that reads the user population's refresh
 * cookie out of the jar. The reasoning is now in that file, beside the values.
 */

/**
 * The impersonation banner, by the design system's own slot and variant.
 *
 * `@repo/ui`'s `data-slot` rather than a text match, so the locator survives
 * every word in the sentence changing and still fails if the region stops being
 * drawn — and `data-variant="warning"` rather than `[data-slot="banner"]`
 * alone, because the shell's banner region can hold the dev-only pseudo-locale
 * notice at the same time (`_dashboard.tsx`' stacked pair).
 */
const banner = (page: Page): Locator =>
  page.locator('[data-slot="banner"][data-variant="warning"]');

/**
 * The one row the mint is aimed at.
 *
 * Found through ADR-0014's `q` in the URL rather than by typing into the
 * toolbar's search box: the box is debounced, so driving it spends a wait on
 * machinery `grid-state.spec.ts` already owns, and the address is the grid's
 * documented public surface since `D5`. The count assertion is what makes the
 * row reference safe — a search that matched two accounts would otherwise pick
 * whichever the API sorted first — and it is the one row count in this tier,
 * which ADR-0052 otherwise keeps out of it: an email address is unique by
 * constraint, so this asserts an invariant rather than the size of a fixture.
 *
 * **It navigates, so it is called once** (`D17.3`). The panel stays on screen
 * across a mint now, and the second mint is driven from the grid the first one
 * left standing — which is the assertion, not a saving.
 */
const customerRow = async (page: Page): Promise<Locator> => {
  await page.goto(`${ADMIN_URL}/users?q=${encodeURIComponent(CUSTOMER_EMAIL)}`);

  const row = page.locator("tbody tr").filter({ hasText: CUSTOMER_EMAIL });

  await expect(row).toHaveCount(1);

  return row;
};

/**
 * Drives one mint from the grid row and hands back the tab it opened.
 *
 * **The page event is subscribed before the click, not after it** — the tab is
 * opened synchronously inside the click (ADR-0070 §1), so a listener registered
 * afterwards races the thing it is listening for.
 *
 * The confirm names the target on the way through. `D13.8`'s MSW suite already
 * pins that the mint is requested for the chosen row and no other, but it opens
 * the dialog directly; what is left over for a browser is the binding between
 * *this* row's menu and the record the dialog was handed — a mistake that would
 * be silent everywhere else, because the mint would succeed and the operator
 * would land in somebody else's account.
 */
const impersonateFrom = async (
  panel: Page,
  row: Locator,
): Promise<{ readonly tab: Page; readonly confirm: Locator }> => {
  await row.getByRole("button", { name: /^Row actions for/ }).click();
  await panel.getByRole("menuitem", { name: "Impersonate" }).click();

  /*
   * `alertdialog`, which is `ConfirmDialog`'s role and not `AppFormDialog`'s:
   * the shared confirm is built on Radix's `AlertDialog` (ADR-0047), whose
   * whole point is that it interrupts. The password dialog further down is an
   * ordinary `dialog`, and the two are named for what they are.
   */
  const confirm = panel.getByRole("alertdialog");

  await expect(confirm).toContainText(CUSTOMER_EMAIL);

  /*
   * **The timeout is short and the message is the point** (`D17.3`, security
   * review). The tab is opened inside the click, so it either arrives at once
   * or the mint was refused — and the refusal this walk can actually provoke is
   * ADR-0057 §1's per-actor budget, which it now spends **twice** per run
   * against `RATE_LIMIT_IMPERSONATION_MAX`. Left to Playwright's default this
   * reads as a thirty-second wait for a page event, with the confirm still open
   * behind a toast nobody sees, which names nothing; `assertApiWindowClear`
   * cannot cover it because that probe reads the *global* limiter's headers and
   * this budget keys on the staff principal's id.
   */
  const opened = panel
    .context()
    .waitForEvent("page", { timeout: 5_000 })
    .catch((cause: unknown) => {
      throw new Error(
        "The confirm opened no tab. The tab is opened synchronously inside the " +
          "click (ADR-0070 §1), so this is the mint being refused rather than a " +
          "slow one: five runs of this spec in a quarter hour spend " +
          "RATE_LIMIT_IMPERSONATION_MAX, which keys on the operator's id and is " +
          "invisible to the global window probe. Wait for the window, or restart " +
          `pnpm dev --filter api. (${cause instanceof Error ? cause.message : String(cause)})`,
      );
    });

  await confirm
    .getByRole("button", { name: "Impersonate", exact: true })
    .click();

  return { tab: await opened, confirm };
};

/**
 * The customer app, booted in the tab the mint opened.
 *
 * Waiting on the heading rather than on a URL, for `support/app.ts`' reason:
 * this app boots `GET /auth/csrf` → `POST /auth/refresh` behind a loading gate,
 * so an address bar that already says `/` is not yet an app. The tab arrives on
 * `about:blank` and is navigated when the mint answers, so this is also the
 * wait for the handover itself.
 */
const landed = async (tab: Page): Promise<void> => {
  await expect(
    tab.getByRole("heading", { name: "Your account", level: 1 }),
  ).toBeVisible();
};

test("an operator opens a customer's account, acts in it, and leaves", async ({
  page: panel,
}) => {
  const context = panel.context();

  /*
   * Before anything else, for `D11.11`'s reason: this walk crosses two apps and
   * spends about fifty requests, so a window that cannot carry it should say so
   * at second zero rather than half way through. The worker's `app` fixture
   * probes too, but only for the specs that use it — this one does not, and a
   * spec that cannot be run alone is a spec nobody debugs.
   *
   * **The floor is this spec's own cost and not the suite's**, which is the
   * distinction `D13.9`'s `security-reviewer` pass turned up: the fixture probes
   * at the tier's first request and may fairly demand the whole suite's, but by
   * the time this file runs the ones before it have already spent their share —
   * so asking for the suite's figure here would abort a healthy run and blame
   * the rate limiter for it.
   *
   * **Re-measured at `D17.3` rather than adjusted**, the `D15.9` discipline, and
   * it nearly doubled: the walk grew a second mint, a second exchange, a second
   * customer app boot and the stale tab's refused request, and a tab brought
   * back to the front refetches what has gone stale behind it. Measured the way
   * every figure in this tier is — a green run of this spec alone took the
   * window from 842 to 792, its own probe included — so it costs **50**, where
   * `D13.9` measured 28. Plus the margin the suite's own floor uses.
   *
   * **It is the first figure in this tier that is not exactly repeatable**, and
   * saying so is cheaper than a number that quietly disagrees with the suite's:
   * two of the stages here turn on a tab regaining focus, and how much a
   * refocused tab refetches depends on which of its queries have passed the
   * 30-second `staleTime` by then. Three green runs measured 50, 50 and 54. The
   * floor takes the low one plus the margin, which is what the margin is for.
   *
   * **`D18.12` measured it a fourth time and got 50 again**, by subtraction
   * rather than in isolation — the whole suite costs 154 and the same suite
   * without this file costs 104 — so the figure holds under both methods and
   * the floor does not move. Nothing in this deliverable touched this walk.
   *
   * **And it is not the only budget this walk spends.** The two mints are two
   * entries of ADR-0057 §1's per-actor allowance, keyed on the operator's id
   * rather than on an address, so five runs in a quarter hour exhaust
   * `RATE_LIMIT_IMPERSONATION_MAX` where `D13.9` had ten. Nothing here can probe
   * it — the headers this function reads belong to the global limiter — so
   * `impersonateFrom` names it in the failure instead.
   */
  await assertApiWindowClear(panel, 63);

  // ---- The mint (ADR-0057 §1; ADR-0070 §1; the admin half `D17.2` built) ----

  await signInAsOperator(panel);

  const row = await customerRow(panel);

  const { tab: customer, confirm } = await impersonateFrom(panel, row);

  // ---- The panel stays (ADR-0070 §1) ----

  /*
   * **The claim the whole record was written for**, and the one that could not
   * be made before `D17`: the operator's context — the row they were reading —
   * is still on screen when the customer app opens. `D17.2` proves the dialog
   * navigates a *handle* rather than this document; that a browser really left
   * this document where it was is only observable here.
   *
   * The dialog first, because it is the ordering signal: it closes once the
   * handle has been navigated and the mutation reset, so a grid asserted before
   * it would be a grid asserted while the mint was still in flight.
   */
  await expect(confirm).toBeHidden();
  await expect(row).toBeVisible();
  expect(panel.url()).toContain("/users?q=");

  // ---- The exchange, in the tab the click opened (ADR-0057 §2, §3) ----

  /*
   * **The seam.** The blank tab's location receives the customer origin with the
   * handoff in the fragment; `/impersonate` reads it, posts it with
   * `X-Auth-Transport: cookie`, and lands home.
   */
  await landed(customer);

  /*
   * **The opener, disowned** (ADR-0070 §2). `tab.opener = null` runs on the
   * admin origin while the tab is still `about:blank`, and a disowned browsing
   * context stays disowned across the navigation that follows — which is the
   * half of the claim only a browser can answer, because jsdom has no second
   * context to disown and the assertion in `D17.2` is about the assignment
   * rather than about its effect. Compared to `null` inside the page rather
   * than returned: a `WindowProxy` is not serialisable across the protocol.
   *
   * This is asserted of the first tab and not of both. The second is opened by
   * the same three lines of the same dialog, so a second check would pin a
   * second execution of one branch — and the production
   * `Cross-Origin-Opener-Policy` that severs it a second time is a property of
   * a deployment's static server, which this dev stack does not run at all.
   */
  expect(
    await customer.evaluate(() => window.opener === null),
    "the customer tab's opener is disowned",
  ).toBe(true);

  /*
   * **The address, whole**, which is three claims in one exact match: this tab
   * is on the *customer* origin (the string is resolved against this project's
   * `baseURL`, so a mint that had built the admin's own address would fail
   * here), it is home rather than still on `/impersonate`, and **the credential
   * is no longer in the *current* address** — `useRedeemHandoff` strikes the
   * fragment as soon as it has been read. That the history *entry* carrying it
   * is gone too follows from both navigations being `replace`, and this line
   * does not establish it: nothing here presses Back.
   *
   * Nothing below jsdom's boundary can check even the first half: a fragment
   * never reaches a server, and a router in a test process has no address bar.
   */
  await expect(customer).toHaveURL("/");

  // ---- The banner (ADR-0057 §4, §6) ----

  /*
   * Both identities, from `principal.impersonatedBy` and from nothing else. The
   * operator's address is the one that could not have come from this browser's
   * own state: it is the staff member the *API* recorded on the session row, so
   * seeing it here is the round trip ADR-0057 §4 designed.
   */
  await expect(banner(customer)).toContainText(CUSTOMER_EMAIL);
  await expect(banner(customer)).toContainText(OPERATOR.email);

  // ---- An excluded operation (ADR-0057 §5) ----

  await customer.goto("/account/security");

  // Still there, on a second screen and after a real document boot — which is
  // what says the fact rides the session rather than a navigation's state.
  await expect(banner(customer)).toContainText(OPERATOR.email);

  await customer.getByRole("button", { name: "Change password" }).click();

  const passwordDialog = customer.getByRole("dialog");

  /*
   * **Deliberately not the fixture customer's real password**, and that is a
   * safety property rather than laziness: `refuseImpersonated` is mounted ahead
   * of `validate` and of the credential check — ADR-0011's order unmodified, the
   * guard being ADR-0057 §5's — so the refusal below does not depend on what is
   * typed, and
   * if the guard ever regressed, the request would fail on the wrong current
   * password instead of quietly changing a seeded account's credential and
   * leaving every later run signed out.
   */
  await passwordDialog.getByLabel("Current password").fill("NotTheRealOne!1");
  await passwordDialog.getByLabel("New password").fill("NotTheRealOne!2");
  await passwordDialog
    .getByRole("button", { name: "Change password", exact: true })
    .click();

  /*
   * The `errors` catalogue's sentence, rendered by the ordinary refusal path —
   * the client knows nothing about impersonation and renders what the API says
   * (ADR-0042's posture). The copy is `D13.3`'s catalogue entry, asserted here
   * as the operator reads it rather than as a code.
   */
  await expect(
    passwordDialog.getByText(
      "That cannot be done while impersonating this account. The account holder has to do it themselves.",
    ),
  ).toBeVisible();

  await customer.keyboard.press("Escape");
  await expect(passwordDialog).toBeHidden();

  // ---- An allowed write (the scoping decision of 2026-09-01) ----

  await customer.goto("/account/preferences");

  /*
   * Settings writes are allowed under impersonation and audited; the exclusion
   * list is exactly the takeover-enabling operations and nothing more. `D13.5`'s
   * integration tier already proves the `PATCH` succeeds and leaves its trail
   * row; what is left over here is narrow and browser-only — that the write goes
   * through on the cookies the *exchange* set, in a document that booted from
   * them.
   *
   * Invariant-style and inside a `try/finally`, per ADR-0052's data rules: this
   * runs against a dev database, and an assertion that failed between the two
   * writes would leave the seeded customer's own app in whatever colour it
   * stopped on. `chosen` and `choose` are `support/app.ts`' since `D13.9` — the
   * same pair `account.spec.ts` uses, so the round trip has one implementation
   * and this file inherits its wait-for-the-`PATCH` discipline rather than
   * writing a third copy of it.
   */
  const before = await chosen(customer, "theme");
  const target = before === "dark" ? "light" : "dark";

  try {
    await choose(customer, "theme", labelFor(THEME_LABELS, target));
  } finally {
    /*
     * Tolerant, because this is cleanup on the failing path too: a restore that
     * threw inside `finally` would replace the failure worth reading.
     */
    await choose(customer, "theme", labelFor(THEME_LABELS, before)).catch(
      () => undefined,
    );
  }

  expect(await chosen(customer, "theme")).toBe(before);

  // ---- A second mint, both tabs alive (ADR-0070 §4) ----

  /*
   * Driven from the grid the first mint left standing, which is the whole
   * hazard the record's §4 answers: with the panel still on screen a second
   * Impersonate is one click away, and its exchange overwrites the first tab's
   * cookies. `D17.1` proves at the wire that the replaced session is revoked
   * and given its `impersonation.ended` row; what a browser adds is that the
   * two tabs really are one jar, and what the stale one does about it.
   *
   * **The first session's token, read before the mint that replaces it.** The
   * replay at the end of this file asserts that a token is revoked, and with two
   * exchanges behind it that assertion is only about the *exit* if the jar
   * really was overwritten — otherwise `spent` would still be this value, which
   * the second exchange revoked, and the replay would pass green over a logout
   * that did nothing (`D17.3`, code review).
   */
  const first = await userRefreshToken(context);

  /*
   * **The panel is not brought to the front first, and that was measured rather
   * than assumed** (`D17.3`, code review). It is a background tab from the first
   * `window.open` onwards, and this stage drives a focus-scoped surface — a
   * Radix dropdown and a menu item inside it — so activating it first is the
   * obvious defensive move. It costs **twelve requests**: a tab regaining focus
   * refetches everything stale behind it, and behind this one is a grid. That
   * takes the spec from 50 to 62, the suite past 165 and ADR-0069 §2's own
   * sizing premise — a tier run and its retry beside the Postman collection —
   * past the 1000 it chose. Playwright dispatches input through CDP rather than
   * through the window manager, so a background tab receives it; if a `--headed`
   * run ever shows otherwise, the fix is one line and the budget is the thing to
   * argue about.
   */
  const { tab: second } = await impersonateFrom(panel, row);

  await landed(second);
  await expect(banner(second)).toContainText(CUSTOMER_EMAIL);
  await expect(banner(second)).toContainText(OPERATOR.email);

  // ---- The stale tab signs itself out, rather than swapping banners ----

  /*
   * **An authenticated request, not a reload**, and the distinction is the one
   * ADR-0070 §4 was amended at this step to state. A reload would boot from the
   * cookie jar — which the second exchange has already overwritten — and land
   * the first tab in the *second* session: the identity swap §Context describes,
   * bounded by the revocation rather than prevented by it. What the revocation
   * really ends is the session this tab is *holding*: its in-memory access token
   * names the revoked row, so the next request carrying it answers `401
   * AUTH_SESSION_REVOKED`, which `@repo/api-client`'s `TERMINAL_AUTH_CODES`
   * refuses to retry — the store is cleared, the router invalidates, and the
   * guard puts the tab on the signed-out screen.
   *
   * **The code, and not merely a sign-out**, which is the discipline the replay
   * at the end of this file already applies. Both mints target the same
   * customer, because the dev fixtures hold one *active* one — so the banner
   * reads identically in either tab and "signed out rather than swapped" is not
   * observable from the screen alone. The refusal is, and it is what says the
   * session was revoked rather than merely expired or dropped.
   *
   * **Two things can drive it, and the wait is registered before either.**
   * React Query refetches stale queries when a window regains focus, and this
   * tab has been in the background across two mints with a 30-second
   * `staleTime` over `GET /user/orgs` — so the focus alone is usually enough,
   * and the click on `Profile` is a backstop for the run where it is not:
   * `/account/profile` is the one section this walk has not opened, so
   * `useProfile` has nothing cached and a client-side navigation to it must
   * reach the wire. If the focus refetch won the race the link is already gone,
   * which is why the click may time out — **and only time out**: a locator that
   * has been renamed or has stopped being unique throws something else, and that
   * is a defect in this file rather than a race, so it is rethrown.
   */
  const refused = customer.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/user/") && response.status() === 401,
  );

  await customer.bringToFront();
  await customer
    .getByRole("link", { name: "Profile", exact: true })
    .click({ timeout: 2_000 })
    .catch((cause: unknown) => {
      if (cause instanceof Error && cause.name === "TimeoutError") return;
      throw cause;
    });

  expect(
    ((await (await refused).json()) as { error: { code: string } }).error.code,
  ).toBe("AUTH_SESSION_REVOKED");

  await expect(
    customer.getByRole("heading", { name: "Sign in", level: 1 }),
  ).toBeVisible();

  /*
   * And no failed refresh was spent doing it: a terminal code is answered by
   * ending the session, not by trying to renew it (`client.ts`), so this stage
   * costs nothing against ADR-0020's five-per-quarter-hour refresh budget —
   * which is the budget the replay at the end of this file exists inside.
   */

  // ---- The exit (ADR-0057 §6), from the tab that still has a session ----

  /*
   * Read **before** the exit, because the exit is what makes it worthless — and
   * read out of the jar rather than out of the app, which cannot see it: the
   * refresh cookie is `HttpOnly` and ADR-0033 says neither app ever reads a
   * cookie itself.
   *
   * The jar holds **the second session's** token by now: one jar, and the
   * second exchange overwrote it. That is the same fact the stage above turns
   * on, read from the other side — and it is asserted rather than assumed,
   * because everything after it depends on it: an exchange that landed its
   * session but wrote no cookie would leave `spent` naming the *first* session,
   * which the second mint already revoked, and the replay below would come back
   * `AUTH_SESSION_REVOKED` over a logout that did nothing.
   */
  const spent = await userRefreshToken(context);

  expect(spent, "the impersonated session is on cookie transport").toEqual(
    expect.any(String),
  );

  expect(spent, "the second exchange overwrote the jar").not.toBe(first);

  await second.bringToFront();

  await banner(second)
    .getByRole("button", { name: "Leave this account" })
    .click();

  await expect(
    second.getByRole("heading", { name: "Sign in", level: 1 }),
  ).toBeVisible();

  /*
   * There is deliberately no "and the banner is gone" line here. `/login` is
   * outside `_dashboard`, which is the only layout that fills the banner slot,
   * so the region could not exist on this screen whatever the session state —
   * the assertion would pass against an API that had revoked nothing. What the
   * exit actually did is established below, at the wire.
   */

  /*
   * **And the session is gone server-side, not merely gone from this tab.**
   * The token above is replayed on the bearer path — a body token, so no cookie
   * and no CSRF are involved and the jar the logout just emptied cannot answer
   * for it.
   *
   * `AUTH_SESSION_REVOKED` and not merely `401`, which is the assertion that
   * makes this a test rather than a formality: that code is reached *after* the
   * token has been verified against a session row (`auth.service.ts`), so it
   * says the credential was genuine and its session is revoked. A garbage value
   * would be a `400` from `refreshTokenSchema` or an `AUTH_REFRESH_TOKEN_INVALID`,
   * and both would pass a bare status check.
   *
   * It spends one of ADR-0020's five failed refreshes per quarter hour per IP,
   * which is the whole reason there is exactly one of them here — and why the
   * stale tab above is driven through a terminal `401` on an ordinary request
   * rather than through a second replay of its own.
   */
  const replayed = await second.request.post(
    `${API_URL}/api/v1/user/auth/refresh`,
    { data: { refreshToken: spent }, failOnStatusCode: false },
  );

  expect(replayed.status()).toBe(401);
  expect(
    ((await replayed.json()) as { error: { code: string } }).error.code,
  ).toBe("AUTH_SESSION_REVOKED");

  // ---- The staff session, untouched (ADR-0057 §1's "no `Set-Cookie`") ----

  /*
   * The claim the whole design is built on: the mints set no cookies, the
   * exchanges set only the user population's, and the logout above cleared only
   * those — so the operator is still signed in on the origin they started from,
   * with no second login anywhere in this test. A full document boot, so the
   * answer comes from `POST /admin/auth/refresh` against the staff cookie that
   * has sat in this jar untouched through the entire episode.
   *
   * It is the panel's own tab, which since `D17` is also the tab the whole
   * episode was driven from — the navigation below is the first thing to move
   * it since the grid.
   */
  await panel.goto(`${ADMIN_URL}/`);

  await expect(
    panel.getByRole("heading", { name: "Dashboard", level: 1 }),
  ).toBeVisible();

  /*
   * The context is this test's own and Playwright disposes of it, so the staff
   * cookies leave with it — `dual-session.spec.ts` clears by hand because its
   * context is worker-scoped and outlives the spec.
   *
   * **On the green path** both impersonated sessions are revoked by the time
   * this line is reached: the first by the second exchange, the second by the
   * exit. There is no `afterEach`, so a failure between a mint and the exit
   * leaves one live for `IMPERSONATION_SESSION_TTL` and — on
   * `retain-on-failure` — its refresh cookie inside the trace. That is a known
   * bound rather than a surprise: `playwright.config.ts` names it beside the
   * handoff token, and this step doubled the number of mints inside the window
   * without closing it. Closing it is `organizations.spec.ts`' `afterEach`
   * shape, and it belongs to a step that can measure what it costs.
   */
});
