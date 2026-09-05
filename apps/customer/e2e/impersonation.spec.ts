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
 * ADR-0052 §The browser tier as ADR-0055 §2 carries it).
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
 */
const customerRow = async (page: Page): Promise<Locator> => {
  await page.goto(`${ADMIN_URL}/users?q=${encodeURIComponent(CUSTOMER_EMAIL)}`);

  const row = page.locator("tbody tr").filter({ hasText: CUSTOMER_EMAIL });

  await expect(row).toHaveCount(1);

  return row;
};

test("an operator opens a customer's account, acts in it, and leaves", async ({
  page,
}) => {
  const context = page.context();

  /*
   * Before anything else, for `D11.11`'s reason: this walk crosses two apps and
   * spends about thirty requests, so a window that cannot carry it should say so
   * at second zero rather than half way through. The worker's `app` fixture
   * probes too, but only for the specs that use it — this one does not, and a
   * spec that cannot be run alone is a spec nobody debugs.
   *
   * **The floor is this spec's own cost and not the suite's**, which is the
   * distinction `D13.9`'s `security-reviewer` pass turned up: the fixture probes
   * at the tier's first request and may fairly demand the whole suite's 77, but
   * by the time this file runs the two before it have already spent about 49 —
   * so asking for 90 here would abort a healthy run and blame the rate limiter
   * for it. 28 measured, plus the margin the suite's own floor uses.
   */
  await assertApiWindowClear(page, 41);

  // ---- The mint (ADR-0057 §1, §7; the admin half `D13.8` built) ----

  await signInAsOperator(page);

  const row = await customerRow(page);

  await row.getByRole("button", { name: /^Row actions for/ }).click();
  await page.getByRole("menuitem", { name: "Impersonate" }).click();

  /*
   * `alertdialog`, which is `ConfirmDialog`'s role and not `AppFormDialog`'s:
   * the shared confirm is built on Radix's `AlertDialog` (ADR-0047), whose
   * whole point is that it interrupts. The password dialog further down is an
   * ordinary `dialog`, and the two are named for what they are.
   */
  const confirm = page.getByRole("alertdialog");

  /*
   * The confirm names the target. `D13.8`'s MSW suite already pins that the mint
   * is requested for the chosen row and no other, but it opens the dialog
   * directly; what is left over for a browser is the binding between *this*
   * row's menu and the record the dialog was handed — a mistake that would be
   * silent everywhere else, because the mint would succeed and the operator
   * would land in somebody else's account.
   */
  await expect(confirm).toContainText(CUSTOMER_EMAIL);

  await confirm
    .getByRole("button", { name: "Impersonate", exact: true })
    .click();

  // ---- The exchange (ADR-0057 §2, §3; the customer half `D13.7` built) ----

  /*
   * **The seam.** `window.open(url, "_self")` sends this tab to the customer
   * origin with the handoff in the fragment; `/impersonate` reads it, posts it
   * with `X-Auth-Transport: cookie`, and lands home. Waiting on the heading
   * rather than on a URL, for `support/app.ts`' reason: this app boots
   * `GET /auth/csrf` → `POST /auth/refresh` behind a loading gate, so an address
   * bar that already says `/` is not yet an app.
   */
  await expect(
    page.getByRole("heading", { name: "Your account", level: 1 }),
  ).toBeVisible();

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
  await expect(page).toHaveURL("/");

  // ---- The banner (ADR-0057 §4, §6) ----

  /*
   * Both identities, from `principal.impersonatedBy` and from nothing else. The
   * operator's address is the one that could not have come from this browser's
   * own state: it is the staff member the *API* recorded on the session row, so
   * seeing it here is the round trip ADR-0057 §4 designed.
   */
  await expect(banner(page)).toContainText(CUSTOMER_EMAIL);
  await expect(banner(page)).toContainText(OPERATOR.email);

  // ---- An excluded operation (ADR-0057 §5) ----

  await page.goto("/account/security");

  // Still there, on a second screen and after a real document boot — which is
  // what says the fact rides the session rather than a navigation's state.
  await expect(banner(page)).toContainText(OPERATOR.email);

  await page.getByRole("button", { name: "Change password" }).click();

  const passwordDialog = page.getByRole("dialog");

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

  await page.keyboard.press("Escape");
  await expect(passwordDialog).toBeHidden();

  // ---- An allowed write (the scoping decision of 2026-09-01) ----

  await page.goto("/account/preferences");

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
  const before = await chosen(page, "theme");
  const target = before === "dark" ? "light" : "dark";

  try {
    await choose(page, "theme", labelFor(THEME_LABELS, target));
  } finally {
    /*
     * Tolerant, because this is cleanup on the failing path too: a restore that
     * threw inside `finally` would replace the failure worth reading.
     */
    await choose(page, "theme", labelFor(THEME_LABELS, before)).catch(
      () => undefined,
    );
  }

  expect(await chosen(page, "theme")).toBe(before);

  // ---- The exit (ADR-0057 §6) ----

  /*
   * Read **before** the exit, because the exit is what makes it worthless — and
   * read out of the jar rather than out of the app, which cannot see it: the
   * refresh cookie is `HttpOnly` and ADR-0033 says neither app ever reads a
   * cookie itself.
   */
  const spent = await userRefreshToken(context);

  expect(spent, "the impersonated session is on cookie transport").toEqual(
    expect.any(String),
  );

  await banner(page)
    .getByRole("button", { name: "Leave this account" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Sign in", level: 1 }),
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
   * which is the whole reason there is exactly one of them here.
   */
  const replayed = await page.request.post(
    `${API_URL}/api/v1/user/auth/refresh`,
    { data: { refreshToken: spent }, failOnStatusCode: false },
  );

  expect(replayed.status()).toBe(401);
  expect(
    ((await replayed.json()) as { error: { code: string } }).error.code,
  ).toBe("AUTH_SESSION_REVOKED");

  // ---- The staff session, untouched (ADR-0057 §1's "no `Set-Cookie`") ----

  /*
   * The claim the whole design is built on: the mint set no cookies, the
   * exchange set only the user population's, and the logout above cleared only
   * those — so the operator is still signed in on the origin they started from,
   * with no second login anywhere in this test. A full document boot, so the
   * answer comes from `POST /admin/auth/refresh` against the staff cookie that
   * has sat in this jar untouched through the entire episode.
   */
  await page.goto(`${ADMIN_URL}/`);

  await expect(
    page.getByRole("heading", { name: "Dashboard", level: 1 }),
  ).toBeVisible();

  /*
   * The context is this test's own and Playwright disposes of it, so the staff
   * cookies leave with it — `dual-session.spec.ts` clears by hand because its
   * context is worker-scoped and outlives the spec.
   */
});
