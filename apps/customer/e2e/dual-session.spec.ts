import type { BrowserContext, Page } from "@playwright/test";

import { expect, test } from "./support/fixtures";

import { leadCard } from "./support/app";

/**
 * Two apps, one browser (`D12.12`; [ADR-0056](../../../docs/adr/0056-per-population-csrf-cookie.md)).
 *
 * **The one spec the browser tier could not honestly write before.** D12's
 * finding 6 came out of `D12.2`'s security review and was a property of the
 * *deployment* rather than of either app: one host-wide `__Host-machxi.csrf`
 * at `Path=/`, rotated by every login and refresh, served both populations —
 * so with the admin panel and the customer app open against the same API host,
 * an admin refresh stranded the customer app's in-memory token. One
 * re-bootstrap recovered it (ADR-0030 echoes rather than rotates, which is why
 * `CSRF_TOKEN_INVALID` stopped being terminal at `D3.2`), and a second `403`
 * inside that window was a forced sign-out caused by traffic in another tab.
 *
 * Nothing below jsdom's boundary can see any of that: it needs two origins,
 * one cookie jar, and a real `Set-Cookie` from a real API. It needs the
 * *browser*, which is exactly ADR-0052's scope for this tier.
 *
 * **It lives in the customer app's suite and not the admin's** because
 * §Definition-of-done item 2 says `git diff` for `apps/admin` is empty across
 * D12 — the same rule that made this a second Playwright config rather than a
 * second `testDir`. The admin panel is reached here by its own address, in the
 * context this suite already owns.
 */

/**
 * Where the admin panel answers, beside this suite's own `baseURL`.
 *
 * `E2E_BASE_URL` and not `E2E_CUSTOMER_BASE_URL`: the unprefixed one is the
 * admin's, which is the convention `support/app.ts` already names — one API
 * means one `E2E_API_URL`, two apps mean two ports. Both are declared on the
 * `test:e2e` task in `turbo.json`.
 */
const ADMIN_URL = process.env["E2E_BASE_URL"] ?? "http://localhost:3001";

/** Where the API answers — `support/app.ts`' variable, one API, one address. */
const API_URL = process.env["E2E_API_URL"] ?? "http://localhost:4000";

/**
 * The operator the admin half signs in as.
 *
 * `apps/admin/e2e/support/app.ts`' constant, written out rather than imported
 * across an app boundary: that file is `apps/admin`'s, and reaching into it
 * would make this spec a diff against an app D12 does not touch. Environment
 * first, the seeded super admin as the default, exactly as it is there.
 */
const OPERATOR = {
  email: process.env["SEED_SUPER_ADMIN_EMAIL"] ?? "admin@machxi.local",
  password: process.env["SEED_SUPER_ADMIN_PASSWORD"] ?? "ChangeMe123!local",
};

/**
 * One population's CSRF cookie, out of the context's jar.
 *
 * Read from Playwright rather than from `document.cookie`: both names are at
 * `Path=/` and both are `Secure`, and the jar is the one place that holds them
 * for every origin in the context at once — which is the thing under test.
 * Neither app ever reads a cookie itself (ADR-0033).
 */
const csrfCookie = async (
  context: BrowserContext,
  population: "admin" | "user",
): Promise<string | undefined> => {
  const name = `__Host-machxi.csrf.${population}`;

  return (await context.cookies()).find((cookie) => cookie.name === name)
    ?.value;
};

/** Signs into the admin panel in the page given, and waits for its shell. */
const signInAsOperator = async (page: Page): Promise<void> => {
  await page.goto(`${ADMIN_URL}/login`);

  await page.getByLabel("Email").fill(OPERATOR.email);
  await page.getByLabel("Password").fill(OPERATOR.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(
    page.getByRole("heading", { name: "Dashboard", level: 1 }),
  ).toBeVisible();
};

test("an admin session's traffic leaves the customer app's alone", async ({
  app,
}) => {
  const context = app.context();

  await app.goto("/account/preferences");

  /*
   * **Waited for, not navigated to.** `goto` resolves on `load`, and this app's
   * boot — `GET /auth/csrf` then `POST /auth/refresh` (ADR-0033) — runs after
   * it, rotating the cookie read below. Reading it mid-boot made this spec
   * fail on its own first run, which is the failure mode worth leaving a
   * comment about: the value was fine, it was simply the one before the
   * refresh the page had not finished making.
   */
  await expect(leadCard(app)).toHaveText("Appearance");

  /*
   * Every `GET /auth/csrf` the *customer* page makes from here on. A
   * re-bootstrap is what the collision used to cost, so its absence is worth
   * recording — as the supporting half of the claim below rather than as the
   * claim itself, which is a distinction this spec's own security review had
   * to make: nothing the page does after this point is CSRF-guarded, so an
   * empty list alone could not have failed.
   *
   * Registered **after** the navigation above, and that is not a detail: this
   * app boots on every document load (ADR-0033), so a listener installed
   * before the `goto` would count the app's own bootstrap and the assertion
   * would be about page loads rather than about the collision.
   */
  const bootstraps: string[] = [];

  app.on("request", (request) => {
    if (request.url().includes("/auth/csrf")) bootstraps.push(request.url());
  });

  const held = await csrfCookie(context, "user");

  expect(held, "the customer app is signed in on cookie transport").toEqual(
    expect.any(String),
  );

  const admin = await context.newPage();

  try {
    /*
     * Login rotates (ADR-0029), and the reload runs the whole boot sequence —
     * `GET /auth/csrf` then `POST /auth/refresh` — so the admin half spends
     * two rotations rather than one. Before ADR-0056 each of them overwrote
     * the value the customer app was holding.
     */
    await signInAsOperator(admin);

    const afterLogin = await csrfCookie(context, "admin");

    await admin.reload();
    await expect(
      admin.getByRole("heading", { name: "Dashboard", level: 1 }),
    ).toBeVisible();

    // The admin really did rotate; without this the assertion below would pass
    // just as well against an API that had stopped writing cookies at all.
    expect(afterLogin).toEqual(expect.any(String));
    expect(await csrfCookie(context, "admin")).not.toBe(afterLogin);

    // The property. Byte-identical, not merely still present.
    expect(await csrfCookie(context, "user")).toBe(held);
  } finally {
    /*
     * The staff session's cookies leave the jar with the page (ADR-0052's rule
     * that a spec cleans up what it writes; `D12.12` security review). The
     * context is **worker-scoped**, so without this a live staff refresh
     * cookie would sit in it for every later spec and land in any later
     * failure trace. Cleared by name rather than by walking the admin panel's
     * account menu to its Sign out — that menu is `apps/admin`'s UI, and a
     * spec in this suite has no business asserting about it.
     */
    await context.clearCookies({ name: "__Host-machxi.csrf.admin" });
    /*
     * **By path as well as by name**, because the refresh cookie's name is the
     * one thing the two populations still share: `__Secure-machxi.refresh` is
     * scoped by `authCookiePath` (ADR-0029), so a filter on the name alone
     * would take the customer app's session out with the operator's.
     */
    await context.clearCookies({
      name: "__Secure-machxi.refresh",
      path: "/api/v1/admin/auth",
    });
    await admin.close();
  }

  /*
   * **The claim, and the only assertion here that fails on a revert.**
   * `held` is what the customer app is holding in memory — the API keeps the
   * cookie and the echoed body copy in step — so a cookie-driven request
   * presenting it is exactly the request the app would make next. Before
   * ADR-0056 the admin's rotation above had overwritten the one shared cookie,
   * so this is the `403 CSRF_TOKEN_INVALID` that cost a re-bootstrap; after
   * it, the token is still this population's own and the request simply
   * succeeds.
   *
   * `page.request` and not `fetch` in the page: it shares the context's cookie
   * jar, which is the thing under test, and it does not need the app to read
   * `document.cookie` — which ADR-0033 says neither app ever does.
   */
  const refreshed = await app.request.post(
    `${API_URL}/api/v1/user/auth/refresh`,
    {
      headers: { "X-Auth-Transport": "cookie", "X-CSRF-Token": held ?? "" },
      failOnStatusCode: false,
    },
  );

  expect(refreshed.status(), await refreshed.text()).toBe(200);

  /*
   * And the customer app still works — a real write through the UI, on the
   * screen it was already standing on. `PATCH /user/settings` is not itself
   * CSRF-guarded (ADR-0029 guards the three cookie-driven auth endpoints), so
   * what this proves is the app, not the check: the session it is acting on
   * survived the other app's traffic intact.
   */
  const before = await app
    .locator('input[name="theme"]:checked')
    .getAttribute("value");

  expect(before, "a theme option is checked").toEqual(expect.any(String));

  /*
   * Endonym-free, but still a table: `system` is a third value, and mapping it
   * to "Light" on the way back would silently rewrite the fixture customer's
   * preference instead of restoring it (`account.spec.ts` makes the same
   * point about reading the enum rather than the label).
   */
  const LABELS: Record<string, string> = {
    light: "Light",
    dark: "Dark",
    system: "System",
  };

  const labelFor = (value: string | null): string => {
    const label = value === null ? undefined : LABELS[value];

    if (label === undefined) throw new Error(`no theme label for ${value}`);

    return label;
  };

  const optionNamed = (name: string) =>
    app
      .locator('input[name="theme"]')
      .and(app.getByRole("radio", { name, exact: true }));

  const target = before === "dark" ? "Light" : "Dark";
  const radio = optionNamed(target);

  const patched = app.waitForResponse(
    (response) =>
      response.url().endsWith("/user/settings") &&
      response.request().method() === "PATCH",
  );

  // The `<label>` is what a customer points at; the radio inside it is
  // `sr-only` and is what the assertion names (`account.spec.ts` says why).
  await radio.locator("xpath=ancestor::label[1]").click();

  expect((await patched).status()).toBe(200);

  /*
   * Restored, per ADR-0052's data rules: this tier runs against a dev database
   * and the fixture customer's own app would otherwise be left in whatever
   * colour a failed assertion stopped on.
   */
  const restore = optionNamed(labelFor(before));

  await restore.locator("xpath=ancestor::label[1]").click();
  await expect(restore).toBeChecked();

  /*
   * No re-bootstrap anywhere in the episode — the sentence ADR-0056's
   * §Consequences promised, and the supporting half of the claim above rather
   * than the claim itself: `PATCH /user/settings` is a bearer request and
   * could not have provoked a bootstrap on its own, so what this line adds is
   * that the *page* never recovered from anything either.
   */
  expect(bootstraps).toEqual([]);

  /*
   * And the context is handed back consistent. The cookie-driven refresh above
   * rotated `…csrf.user`, so the app is now holding the value from before it;
   * a reload re-bootstraps and re-refreshes, which is what a customer's own
   * tab does anyway and what every later spec in this worker starts from.
   */
  await app.reload();
  await expect(leadCard(app)).toHaveText("Appearance");
});
