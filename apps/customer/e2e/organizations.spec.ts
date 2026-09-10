import { randomUUID } from "node:crypto";

import type { BrowserContext } from "@playwright/test";

import { expect, test } from "./support/fixtures";

import {
  API_URL,
  CUSTOMER_EMAIL,
  USER_REFRESH_COOKIE,
  assertApiWindowClear,
  csrfCookie,
  refreshCookiePaths,
  settingsNav,
} from "./support/app";
import { linkFromMail, waitForMail } from "./support/mail";

/**
 * The organizations walk, end to end and across two accounts (`D15.8`;
 * [ADR-0067](../../../docs/adr/0067-organizations.md), ADR-0052 §The browser
 * tier as ADR-0055 §2 carries it).
 *
 * **What only this tier can say.** Six steps built the halves and each proved
 * its own where it could: `D15.2` and `D15.3` cover the invariants, the guard
 * and the whole invitation lifecycle at the wire; `D15.5` drives the switcher,
 * the settings screens and the inbox against MSW; `D15.6` drives the
 * registration form the same way. What none of them can do is put **two
 * accounts in two browsers on one database** — MSW answers whatever the fixture
 * says, supertest has no switcher, and jsdom cannot hold a cookie jar per
 * origin. So the seam this deliverable is actually about — an offer made by one
 * person and taken by another, with the tenant appearing in the second
 * person's chrome — was untested until here.
 *
 * **And one claim `D15.6` explicitly left to a browser**: the refresh cookie
 * the API sets from the **public** segment is scoped to `/api/v1/user/auth`, so
 * the next reload's refresh sends it. The suites there assert the header that
 * asks for cookie transport; only a jar can say where the cookie landed. Since
 * `D18.4` that cookie arrives from the *confirmation* rather than from
 * registration (ADR-0071 §3), which is the same claim one endpoint along.
 *
 * **And two this deliverable adds, both of them mailboxes**: the walk reads its
 * confirmation link out of **Mailpit** (`D18.4`), and since `D18.8` the invitee
 * follows a mailed invitation link rather than accepting from the account
 * area. Every flow in ADR-0071 is a single-use token delivered in a link's
 * fragment, and a tier that cannot open a mailbox can watch a form say "we
 * have sent you a link" and nothing after it — so the run is made with
 * `MAIL_TRANSPORT=smtp` against the local compose (`support/mail.ts`).
 *
 * Address-match acceptance from `/account/invitations` is unchanged and is
 * still the other half of ADR-0067 §4; what moved is which of the two this
 * walk exercises, because the link is the half no other tier can reach.
 *
 * **One test, not six.** Every stage below depends on the one before it — an
 * invitation cannot be accepted before it is created, and an organization
 * cannot be deleted before it exists — so splitting them would mean
 * re-registering an account per test: more of ADR-0020's window, more rows in a
 * dev database, and a set of tests each silently depending on the last. The
 * stages are commented instead.
 *
 * **Two contexts, and they are the point.** The default `page` fixture gives
 * this test its own context for the account it registers; the worker's `app`
 * fixture is the seeded customer, signed in for the length of the run. Two
 * people, two browsers, one API.
 *
 * **ADR-0052's data rule is honoured by the walk itself, in the only sense this
 * schema allows.** The account and the organization this spec creates are
 * removed by its own last two stages — the team organization first, because an
 * account's deletion takes only its personal one. Both removals are **soft**
 * (ADR-0028, ADR-0067 §2), so a green run does not leave the database
 * byte-identical: it leaves closed rows that every read filters out by
 * `deleted_at is null`, which is what "cleaned up" means for a schema that
 * deletes nothing. Nothing a later run or a later screen can see survives it.
 *
 * **A run that fails midway keeps its rows, and gives up its credential.** The
 * rows are the evidence a failure is diagnosed from and they carry a per-run
 * address no later run can collide with, so deleting them from a `finally`
 * would delete the diagnosis. The **session** is a different matter: a retained
 * trace records the registration's response, and `playwright.config.ts` bounds
 * what a trace may hold to committed constants and credentials that expire in
 * minutes. A refresh cookie for a live account is neither — `REFRESH_TOKEN_TTL`
 * is thirty days — so the `finally` revokes the session and keeps everything
 * else (`D15.8`'s security review).
 */

/**
 * What makes this run's names its own.
 *
 * Base-36 milliseconds: short enough to read in a failure message, unique
 * enough that two runs a second apart cannot meet in the `organizations.slug`
 * unique index — which is global, so a fixed slug would make the second run of
 * the suite fail on a `409` from the first.
 */
const stamp = Date.now().toString(36);

/** The account this spec registers, and closes again at the end. */
const NEWCOMER = {
  email: `e2e-org-${stamp}@machxi.local`,
  /*
   * **Per run, not committed** (`D15.8`'s security review). It has to satisfy
   * `passwordSchema` without importing `MIN_PASSWORD_LENGTH` — reaching into
   * `@repo/contracts` for a constant would be the one import that makes this
   * suite care what the policy is, and the policy is `D15.6`'s to assert — and a
   * uuid with a suffix does that with room to spare. The reason it is generated
   * rather than written down is the failure path above: the account survives a
   * failed run on purpose, so a literal here would be a live account on a shared
   * dev database whose password is in git.
   */
  password: `${randomUUID()}Aa1!`,
};

/** The team organization this spec creates, invites into, and deletes. */
const TEAM = { name: `E2E Team ${stamp}`, slug: `e2e-team-${stamp}` };

/**
 * Ends the newcomer's session without touching a row (`D15.8`'s security
 * review).
 *
 * Cookie transport, so it needs the double-submit header (ADR-0029): the
 * refresh cookie is `HttpOnly` and the CSRF cookie is not the app's to read
 * (ADR-0033), so both come out of the jar. Tolerant throughout — this runs on
 * the failing path, where the session may already be gone and where an error
 * raised here would replace the failure worth reading.
 */
const revokeNewcomerSession = async (
  context: BrowserContext,
): Promise<void> => {
  const token = await csrfCookie(context, "user");

  await context.request
    .post(`${API_URL}/api/v1/user/auth/logout`, {
      failOnStatusCode: false,
      headers: { "X-Auth-Transport": "cookie", "X-CSRF-Token": token ?? "" },
    })
    .catch(() => undefined);
};

/**
 * Whatever happened, the newcomer's session does not outlive this file.
 *
 * A hook rather than a `finally` inside the test, so it runs on the paths a
 * `finally` would miss — a timeout, an `expect` that failed before the walk
 * reached its own cleanup — and so the walk reads as one episode rather than as
 * a block with a tail. On the green path the account is already closed and the
 * session already revoked, so this answers `401` and is ignored; on every other
 * path it is what keeps a thirty-day credential out of the retained trace.
 */
test.afterEach(async ({ page }) => {
  await revokeNewcomerSession(page.context());
});

test("an account registers, makes a team, invites somebody, and they join", async ({
  app,
  page,
  request,
}) => {
  const context = page.context();

  /*
   * Before anything else, for `D11.11`'s reason and with `D13.9`'s correction:
   * the floor is **this spec's own cost**, not the suite's. The worker's `app`
   * fixture probes for the whole suite at the tier's first request; by the time
   * this file runs the three before it have spent most of that, so demanding
   * the suite's figure here would abort a healthy run and blame the limiter for
   * it. Measured the way every other floor in this tier was — a green run of
   * this file alone took the window from 240 to 198, which is **42** with the
   * worker fixture's own probe and sign-in inside it; those are already spent
   * by the time this file runs in the tier, so what it adds there is about
   * **36** — and the margin is the dozen `D12.10` chose.
   *
   * **52 since `D18.4`**, for the reason `support/app.ts` gives about its own
   * default: the walk now follows the confirmation link out of a mailbox, which
   * is a second full document load — two boot requests — plus the confirmation
   * itself. Three, reasoned rather than measured; `D18.12` re-measures.
   */
  await assertApiWindowClear(page, 52);

  // ---- Registration, and the personal organization it creates (§2, §6) ----

  await page.goto("/register");

  await expect(
    page.getByRole("heading", { name: "Create an account", level: 1 }),
  ).toBeVisible();

  await page.getByLabel("Email").fill(NEWCOMER.email);
  await page.getByLabel("Password").fill(NEWCOMER.password);
  await page.getByRole("button", { name: "Create account" }).click();

  /*
   * **Landed on the check-your-mail screen, and signed into nothing**
   * (`D18.4`, ADR-0071 §3). Registration answers `202` and issues no session:
   * an address nobody has proven is not an account anybody may be signed into,
   * so what a browser sees here is the confirmation screen and not a home
   * screen. `D15.6` asserted the opposite and was right at the time.
   */
  await expect(page.getByText(/Follow the link in your inbox/)).toBeVisible();

  /*
   * **The half only this tier can prove.** Everything up to here — the form,
   * the `202`, the screen — is asserted against MSW by the component suite,
   * and everything after the token reaches the API is asserted against a
   * database by the integration tier. What neither can do is take the token
   * out of a *mailbox*: the link is what a person actually follows, its
   * fragment never reaches a server, and the SPA route that strikes it is the
   * only thing that turns it into a session (ADR-0071 §1, §3).
   *
   * `request` rather than `page.request`, and the isolation is the point: the
   * browser context's jar holds this account's cookies and Mailpit is another
   * process on the same host, so a request made through the page would carry
   * a live `Path=/` CSRF cookie to a server that has no business seeing one.
   */
  const message = await waitForMail(request, NEWCOMER.email);

  await page.goto(linkFromMail(message, "/verify-email"));

  /*
   * Landed signed in, on this app's home screen — the same heading `signIn`
   * waits for. The link proved the mailbox and the device that opened it is
   * signed in, which is ADR-0071 §3's whole answer to "verified before login".
   */
  await expect(
    page.getByRole("heading", { name: "Your account", level: 1 }),
  ).toBeVisible();

  /*
   * **The claim `D15.6` could not make, moved one endpoint along** (`D18.4`).
   * It was registration that set the cookie and it is now
   * `POST /api/v1/public/auth/verify-email`; the property is unchanged and so
   * is the reason it needs a browser. Both answer on the *public* segment, and
   * the cookie has to be scoped to the *user* segment's `authCookiePath` or
   * the next boot's refresh will never send it — an account that is signed in
   * until the first reload, which is the `D13.7` failure one endpoint along
   * and which no response body shows.
   *
   * **The whole set of paths, not the first match** (`D15.8`'s security
   * review): asking "did one land here" cannot fail if the API *also* wrote
   * `__Secure-machxi.refresh` at `Path=/`, and a host-wide refresh cookie is the
   * failure that matters — it would be sent to `/api/v1/admin/auth` as well,
   * which is the cross-population confusion ADR-0029's per-segment path and
   * ADR-0056 exist to prevent.
   */
  expect(
    await refreshCookiePaths(context),
    "the confirmation set the refresh cookie on the user segment and nowhere else",
  ).toEqual([USER_REFRESH_COOKIE.path]);

  /*
   * And the boot that follows actually uses it. A full document load, so the
   * session comes back from `GET /auth/csrf` → `POST /auth/refresh` against
   * the jar rather than from anything this tab still held in memory.
   */
  await page.reload();

  await expect(
    page.getByRole("heading", { name: "Your account", level: 1 }),
  ).toBeVisible();

  /*
   * ADR-0067 §2: every path that creates a user creates a personal
   * organization, so the switcher is never empty and no screen has a "no
   * organization" branch. **What a browser sees of it since `D15.9` is the
   * word "Private" and nothing else** (§6 as amended 2026-09-07): the
   * organization's name is unmanaged, its slug is derived, and the context
   * lives at the root — so the address bar of the screen a private person
   * spends most of their time in carries no uuid at all.
   *
   * This is the assertion the amendment came from. The operator's `D15.8`
   * browser walk found `/orgs/personal-<uuid>/…` in every URL of the private
   * context and a switcher whose entries opened settings; the old spec asserted
   * that URL as if it were the design.
   */
  await expect(page).toHaveURL("/");

  const switcher = page.getByRole("button", { name: "Switch organization" });

  await expect(switcher).toHaveText(/Private/);

  await switcher.click();

  const privateEntry = page.getByRole("menuitem", { name: /Private/ });

  await expect(privateEntry).toBeVisible();

  /*
   * The account's own email is not an entry: the personal organization is the
   * private context rather than a tenant in the list, so it is neither named
   * nor addressable.
   */
  await expect(
    page.getByRole("menuitem").filter({ hasText: NEWCOMER.email }),
  ).toHaveCount(0);

  /*
   * And there is no way into settings from here — a personal organization has
   * no settings surface at all (§6), so the entry is absent rather than
   * present-and-refused.
   */
  await expect(
    page.getByRole("menuitem", { name: "Organization settings" }),
  ).toHaveCount(0);

  // ---- A team organization, from the switcher's own menu (§6 as amended) ----

  await page.getByRole("menuitem", { name: "New organization" }).click();

  const create = page.getByRole("dialog");

  await create.getByLabel("Name").fill(TEAM.name);
  await create.getByLabel("Address").fill(TEAM.slug);
  await create.getByRole("button", { name: "Create", exact: true }).click();

  // The create surface navigates into what it made (`D15.5`).
  await expect(page).toHaveURL(`/orgs/${TEAM.slug}`);

  // And the trigger now names the context the caller is acting in.
  await expect(switcher).toHaveText(new RegExp(TEAM.name));

  /*
   * The way into a team's settings is the switcher's menu since `D15.9` — not a
   * button on a summary card, which is the surface the amendment retired. It
   * lands on the area's first section (§6, ADR-0053 §1's arrangement).
   */
  await switcher.click();
  await page.getByRole("menuitem", { name: "Organization settings" }).click();

  await expect(page).toHaveURL(`/orgs/${TEAM.slug}/settings/general`);

  // ---- The invitation, addressed to the seeded customer (§2, §4) ----

  await settingsNav(page).getByRole("link", { name: "Invitations" }).click();

  await expect(page).toHaveURL(`/orgs/${TEAM.slug}/settings/invitations`);

  await page.getByRole("button", { name: "Invite somebody" }).click();

  const invite = page.getByRole("dialog");

  await invite.getByLabel("Email address").fill(CUSTOMER_EMAIL);
  await invite.getByRole("button", { name: "Send invitation" }).click();

  // Listed as pending, by the address it was sent to. The default role is
  // `member`, so nothing here touches the role control.
  await expect(page.getByRole("cell", { name: CUSTOMER_EMAIL })).toBeVisible();

  // ---- The last owner cannot leave (§2's invariant) ----

  /*
   * The newcomer is the team's only owner, so leaving would take the last one
   * out — refused with `409 ORGANIZATION_LAST_OWNER` and rendered as the
   * `errors` catalogue's sentence, which is what an owner actually reads.
   * `D15.5` proves the same refusal against MSW; what is browser-only is that
   * the refusal survives a real transaction-scoped lock on a real row.
   *
   * Before the acceptance below rather than after, deliberately: it is true
   * either way — a `member` is not an owner — and asserting it here means the
   * team has exactly one member, so the row's own control is unambiguous.
   */
  await settingsNav(page).getByRole("link", { name: "Members" }).click();

  await expect(page).toHaveURL(`/orgs/${TEAM.slug}/settings/members`);

  await page.getByRole("button", { name: "Leave", exact: true }).click();

  const leaving = page.getByRole("alertdialog");

  await leaving.getByRole("button", { name: "Leave", exact: true }).click();

  await expect(
    page.getByText(
      "An organization needs at least one owner. Make someone else an owner first.",
    ),
  ).toBeVisible();

  // The dialog stays open on a refusal — closing is `onSuccess`'s — so it is
  // dismissed by hand before the screen is used again.
  await page.keyboard.press("Escape");
  await expect(leaving).toBeHidden();

  // ---- The second account accepts, from the mailed link (§5, ADR-0071 §5) ----

  /*
   * `app` is the worker's signed-in seeded customer — a different context, a
   * different jar and a different account, which is the only honest way to walk
   * an invitation.
   *
   * **From the link rather than from the account area, since `D18.8`.** The
   * inbox is still there and still accepts by address match (ADR-0067 §4), and
   * `account.spec.ts`'s and the component suite's cases cover it; what only
   * this tier can do is take a token out of a *mailbox* and let a browser
   * follow it. That is the half of ADR-0071 §5 no other tier reaches: the
   * integration suite reads its links out of the `MailSender` port and MSW
   * answers whatever the fixture says.
   *
   * **The subject marker is not optional here**, and it is the one place in
   * this tier where the recipient is not the run's own address. The seeded
   * customer's mailbox holds every invitation every previous run ever sent, so
   * "the newest message to that address" is an older run's until this one is
   * delivered — and the link in it was consumed weeks ago. The organization's
   * name carries this run's stamp and the template puts it in the subject.
   */
  const invitation = await waitForMail(request, CUSTOMER_EMAIL, TEAM.name);

  await app.goto(linkFromMail(invitation, "/invitations/accept"));

  /*
   * The offer, read before anything is joined: the lookup is unauthenticated
   * and consumes nothing, so the screen can say what is being offered and by
   * whom to whoever opened the mail (ADR-0071 §5).
   */
  await expect(
    app.getByText(`${TEAM.name} has invited you to join as Member.`),
  ).toBeVisible();

  await app.getByRole("button", { name: "Accept the invitation" }).click();

  /*
   * **Landed in the organization**, which is the acceptance and the navigation
   * in one: the token proved the mailbox, the session proved the account, and
   * the API answered with the organization joined.
   *
   * **And the screen resolved, which the address does not say** (`D15.8`'s
   * review, carried onto the shape `D15.9` replaced it with). The slug is
   * matched client-side against the switcher's list, so an organization this
   * account is not in renders `AppNotFound` at exactly this URL — the home
   * screen naming the context is what says the membership the acceptance
   * created is really there.
   */
  await expect(app).toHaveURL(`/orgs/${TEAM.slug}`);
  await expect(app.getByText(`You are in ${TEAM.name}.`)).toBeVisible();

  /*
   * And the tenant is in this person's chrome. The switcher is the shell's, so
   * this is the acceptance arriving on a surface that never asked about it —
   * the entity hook invalidates both lists, which is the thing MSW can only
   * pretend to do.
   */
  const appSwitcher = app.getByRole("button", { name: "Switch organization" });

  await expect(appSwitcher).toHaveText(new RegExp(TEAM.name));

  // ---- The switch itself: the screen is kept, the prefix moves (§6) ----

  /*
   * **The claim `D15.9` exists for, and the one only a browser proves end to
   * end.** The switcher keeps the screen a customer is on and swaps the
   * prefix — so a member standing on their own profile stays on their own
   * profile, and the context they come back to is the one they left.
   *
   * `/account/*` is self-scoped, so the trigger goes on naming the team while
   * the caller stands there — the remembered context, read on this device under
   * this principal's key, which is what stops a trip to one's profile from
   * ejecting somebody into the private context on the way back.
   */
  await app.goto("/account/profile");

  await expect(appSwitcher).toHaveText(new RegExp(TEAM.name));

  await appSwitcher.click();
  await app.getByRole("menuitem", { name: /Private/ }).click();

  /*
   * A self-scoped screen has no per-tenant twin, so choosing a context from one
   * lands in that context rather than pretending a profile has two addresses.
   */
  await expect(app).toHaveURL("/");
  await expect(app.getByText("You are in your private space.")).toBeVisible();

  // And back, which is the round trip rather than a one-way navigation.
  await appSwitcher.click();
  await app.getByRole("menuitem", { name: TEAM.name }).click();

  await expect(app).toHaveURL(`/orgs/${TEAM.slug}`);
  await expect(app.getByText(`You are in ${TEAM.name}.`)).toBeVisible();

  // ---- Cleanup, which is also the last two claims (§2) ----

  /*
   * The owner deletes the team. Soft on the server — the row is hidden and the
   * address released — and the card navigates out of the organization it just
   * removed rather than leaving the browser on a slug that no longer resolves.
   */
  await settingsNav(page).getByRole("link", { name: "General" }).click();

  await page.getByRole("button", { name: "Delete", exact: true }).click();

  const deleting = page.getByRole("alertdialog");

  await deleting.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(page).toHaveURL("/");

  /*
   * And the account closes itself, which takes its personal organization with
   * it in the same transaction (ADR-0067 §2, ADR-0028's semantics). Reached by
   * clicking rather than by `page.goto`, so the walk pays one client-side
   * navigation instead of another whole boot.
   */
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: "Account", exact: true })
    .click();

  await settingsNav(page).getByRole("link", { name: "Security" }).click();

  await page.getByRole("button", { name: "Delete account" }).click();

  const closing = page.getByRole("dialog");

  await closing.getByLabel("Current password").fill(NEWCOMER.password);
  await closing
    .getByRole("button", { name: "Delete account", exact: true })
    .click();

  /*
   * Signed out everywhere, this device included — the sign-in screen is what
   * says the session the deletion revoked is gone from this tab rather than
   * merely forgotten by it.
   */
  await expect(
    page.getByRole("heading", { name: "Sign in", level: 1 }),
  ).toBeVisible();

  /*
   * The seeded customer's membership survives the organization's soft delete as
   * a row and not as access — every read joins `organizations` and filters
   * `deleted_at is null` (`D15.1`'s note to `D15.2`) — so the tenant is gone
   * from the second account's switcher without anything having deleted the
   * membership. A full reload, because the switcher's list is cached per
   * context and this account was never told.
   */
  await app.goto("/");

  await app.getByRole("button", { name: "Switch organization" }).click();

  /*
   * **The menu is proved open before the absence is asserted** (`D15.8`'s
   * review). `toHaveCount(0)` is satisfied by its first evaluation, which
   * happens before Radix has mounted the portal — so on its own it would pass
   * against a switcher that still listed the deleted tenant. Every account has
   * a private context and it is always the first entry, so a positive control
   * is available without asserting a list length.
   */
  await expect(app.getByRole("menuitem", { name: /Private/ })).toBeVisible();

  await expect(app.getByRole("menuitem", { name: TEAM.name })).toHaveCount(0);

  await app.keyboard.press("Escape");
});
