import { expect, test } from "./support/fixtures";

import { CUSTOMER_EMAIL } from "./support/app";

/**
 * Sign-in, from both sides of it (`D12.10`; ADR-0055 §2, ADR-0053 §2/§3).
 *
 * **What only this tier can say.** The component suite proves both guards
 * against a router in jsdom, where the session store is handed to the router as
 * context and `isAuthenticated()` answers whatever the test set. Here the
 * answer comes from a real boot against a real API — `GET /auth/csrf` →
 * `POST /auth/refresh` behind `SessionProvider`'s loading gate (ADR-0033) —
 * and the claim is the ordering: the guard runs *after* the boot has settled,
 * so a visitor with no session sees the sign-in screen rather than a flash of
 * the shell, and a visitor with one is never bounced out of it.
 */

/**
 * Signed out, so it takes `page` rather than the worker's signed-in `app`.
 *
 * **One navigation, and the arithmetic is the reason.** An anonymous boot's
 * refresh fails by definition, and ADR-0020's refresh limiter allows five
 * failures per quarter hour per IP — a budget this app now shares with the
 * admin's tier, which spends one on its own signed-out screen. So the whole
 * claim is made in a single `goto`.
 */
test("a protected address, signed out, is this app's sign-in screen — and it remembers where you were going", async ({
  page,
}) => {
  await page.goto("/account/security");

  /*
   * The heading first: the redirect is thrown in `beforeLoad`, so the address
   * bar changes before the screen exists, and asserting the URL alone would
   * pass on an app that never rendered.
   */
  await expect(
    page.getByRole("heading", { name: "Sign in", level: 1 }),
  ).toBeVisible();

  /*
   * `_dashboard`'s guard carries the attempted location so a session that
   * expires mid-task returns someone to the screen they were on. Encoded,
   * because it travels as a search parameter.
   */
  await expect(page).toHaveURL(/\/login\?redirect=%2Faccount%2Fsecurity$/);

  /*
   * And it is *this* app's screen, not the admin's. The two apps share the
   * geometry and share none of the words (ADR-0046 §13); the tagline is the
   * cheapest string that could only have come from this app's catalogue, and
   * a wrong `E2E_CUSTOMER_BASE_URL` pointed at port 3001 would otherwise pass
   * every other assertion in this file.
   *
   * Case-insensitive, because the brand line is set in ADR-0054 §3's caps rung
   * and `uppercase` is a *paint*: the catalogue says "machxi account" and the
   * screen says "MACHXI ACCOUNT". Asserting the painted form would be asserting
   * a CSS property in the one place this file means to assert copy.
   */
  await expect(page.getByText(/machxi account/i)).toBeVisible();
});

test("signing in lands on the shell, and the account control names who signed in", async ({
  app: page,
}) => {
  /*
   * **Navigated first, because the page is worker-scoped and shared.** The
   * fixture signs in once for the whole run and hands the *same* page to every
   * spec, so this file inherits wherever `account.spec.ts` finished — the
   * preferences section, on the run where the files go in alphabetical order.
   * The session is what is shared; the location is not part of the fixture's
   * contract, so a spec that needs a screen asks for it.
   */
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Your account", level: 1 }),
  ).toBeVisible();

  /*
   * ADR-0053 §3: the drawer is domain navigation and the account is not a
   * domain. The component suite asserts `NAVIGATION` holds one item; this
   * asserts nothing else put a way into the area there — a `SidebarFooter`
   * link would satisfy that suite and fail here.
   *
   * **By destination, not by name, and that is this app's own correction to
   * the admin's form of the same claim.** The admin matches links named
   * `/account|profile/i`, which works there because its brand block says
   * "Admin". This app's brand block says `common:brand.product` — and
   * ADR-0055 §5's word for this app is *Account*, so the drawer's link home is
   * accessibly named "m machxi Account" and a name query finds it every time.
   * An `href` is what the claim was always about: no element in the drawer
   * navigates into the account area.
   */
  const drawer = page.locator('[data-slot="sidebar-container"]');

  await expect(drawer.locator('a[href^="/account"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Account", exact: true }).click();

  const menu = page.getByRole("menu");

  /*
   * ADR-0053 §2's slim menu, as an inventory: identity, one way in, the way
   * out. `toHaveText` over the whole set is what makes a fourth entry a
   * failure rather than an unnoticed addition — and in this app that matters
   * more than in the admin, because the preferences that would want to hang
   * here have a section of their own (`D12.7`) and no reason to come back.
   */
  await expect(menu.getByRole("menuitem")).toHaveText(["Account", "Sign out"]);
  await expect(menu.getByRole("menuitemradio")).toHaveCount(0);

  /*
   * `.last()`, because the label renders the address twice on an account with
   * no name: `displayName` falls back to the email, so the two spans carry the
   * same text and a bare `getByText` fails on strict mode rather than on the
   * claim. A customer's names are nullable in the schema (ADR-0017), so that
   * is a live state here rather than a hypothetical.
   */
  await expect(menu.getByText(CUSTOMER_EMAIL).last()).toBeVisible();

  await menu.getByRole("menuitem", { name: "Account", exact: true }).click();

  /*
   * The entry names the *area* and the index route chooses the section
   * (ADR-0053 §1), so the click lands one redirect deeper than it aimed.
   */
  await expect(page).toHaveURL(/\/account\/profile$/);
});
