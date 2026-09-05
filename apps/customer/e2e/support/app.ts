import {
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

/**
 * What every customer spec needs and no spec should re-derive (`D12.10`).
 *
 * Sign-in, the rate-limit probe, and the handful of locators the walk keeps
 * reaching for — all named by **role and accessible name**, the discipline
 * ADR-0036 imposes on the component tier and ADR-0052 carries into this one: a
 * control this file cannot name is one a screen reader cannot name either.
 */

/**
 * The customer the suite signs in as (ADR-0052 §The browser tier's data rules).
 *
 * **A `--dev` fixture, not a seeded operator**, which is the one place this
 * file cannot follow the admin's: `SEED_SUPER_ADMIN_*` names a staff account on
 * the `/admin` segment, and `/user/auth/login` would refuse it whatever the
 * password. The default is `packages/db/seeds/dev/fixtures.ts`' `DEV_USERS[0]`
 * with `DEV_PASSWORD` — the *active* customer, since the login flow admits
 * active accounts only — so this tier assumes `pnpm db:seed -- --dev` has run,
 * exactly as ADR-0052 says it may.
 *
 * The two values are **written out rather than imported** from `@repo/db`: that
 * package reaches Postgres, and importing it here would put a database driver
 * in a browser app's dependency graph to read two constants. Environment first,
 * so a machine seeded with anything else passes its own credentials in.
 */
const CREDENTIALS = {
  email: process.env["E2E_CUSTOMER_EMAIL"] ?? "customer@machxi.local",
  password: process.env["E2E_CUSTOMER_PASSWORD"] ?? "DevPassword!123",
};

/**
 * The signed-in customer's address, for the one claim that needs it: the
 * account control shows who is signed in.
 *
 * Exported from the same constant the sign-in uses rather than written out
 * again, so a machine seeded from its own fixtures asserts about the account it
 * actually has — the whole reason `CREDENTIALS` reads the environment first.
 */
export const CUSTOMER_EMAIL = CREDENTIALS.email;

/**
 * Signs in and waits for the shell.
 *
 * The wait is on the home screen's heading rather than on a URL: this app boots
 * `GET /auth/csrf` → `POST /auth/refresh` behind a loading gate before anything
 * renders (ADR-0033), so an address bar that already says `/` is not yet an
 * app. The heading is `home:title` — "Your account", not the admin's
 * "Dashboard", which is the word ADR-0055 §5 says this app does not use.
 */
export const signIn = async (page: Page): Promise<void> => {
  await page.goto("/login");

  await page.getByLabel("Email").fill(CREDENTIALS.email);
  await page.getByLabel("Password").fill(CREDENTIALS.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(
    page.getByRole("heading", { name: "Your account", level: 1 }),
  ).toBeVisible();
};

/** ADR-0053 §4's nav landmark, by the slot `@repo/ui` puts on it. */
export const settingsNav = (page: Page): Locator =>
  page.locator('[data-slot="settings-nav"]');

/**
 * The pane the matched section renders into.
 *
 * Not exported: `leadCard` is the only reader, and a support module with a
 * symbol no spec names is the same shape `D12.9`'s review struck out of the
 * `shared/ui` door. It becomes an export when a spec asks for it.
 */
const settingsContent = (page: Page): Locator =>
  page.locator('[data-slot="settings-content"]');

/**
 * The first card a section puts up — what proves the right one rendered.
 *
 * A card title is a `div` (the shadcn primitive's, ADR-0047), not a heading, so
 * it is reached by its slot rather than by role — the one place in this harness
 * that names a DOM detail, and it names the design system's own contract rather
 * than a class.
 */
export const leadCard = (page: Page): Locator =>
  settingsContent(page).locator('[data-slot="card-title"]').first();

/**
 * Where the API answers, for the requests this suite makes directly.
 *
 * Shared with the admin's tier on purpose, and it is the variable that shows
 * why `E2E_CUSTOMER_BASE_URL` is not: there is one API, so there is one
 * address, while two apps mean two ports.
 *
 * **Exported since `D13.9`**, because it stopped being one file's constant:
 * `dual-session.spec.ts` had already written it out a second time and
 * `impersonation.spec.ts` would have been the third. One address, one line.
 */
export const API_URL = process.env["E2E_API_URL"] ?? "http://localhost:4000";

/**
 * Where the **admin panel** answers, beside this suite's own `baseURL`
 * (`D12.12`, moved here at `D13.9`).
 *
 * `E2E_BASE_URL` and not `E2E_CUSTOMER_BASE_URL`: the unprefixed one is the
 * admin's, which is the convention this file already names — one API means one
 * `E2E_API_URL`, two apps mean two ports. Both are declared on the `test:e2e`
 * task in `turbo.json`.
 *
 * **Two specs in this suite reach the admin panel now**, which is what moved
 * this out of `dual-session.spec.ts`: that one walks ADR-0056's two-population
 * cookie jar, and `impersonation.spec.ts` walks the mint that starts on that
 * origin and ends on this one. A second copy of an address is a second thing to
 * get wrong when a port moves.
 */
export const ADMIN_URL = process.env["E2E_BASE_URL"] ?? "http://localhost:3001";

/**
 * The customer app's refresh cookie, by the name and the per-segment
 * `authCookiePath` ADR-0029 gives it — the decision ADR-0056 explicitly leaves
 * standing when it splits the *CSRF* cookie per population.
 *
 * The path is part of the match and not decoration: `__Secure-machxi.refresh`
 * is the one name the two populations still share, so a lookup by name alone
 * would answer with a staff cookie as readily as with this session's — which is
 * exactly the confusion `dual-session.spec.ts` has to clean up by path as well
 * as by name.
 *
 * **Written out here at `D13.9` and moved into this file at `D15.8`**, when
 * `organizations.spec.ts` became the second spec that reads it — and it reads
 * it for the opposite reason, which is what makes the shared lookup worth
 * having: one spec wants the *value*, to replay a token the exit revoked, and
 * the other only wants to know the cookie **landed at this path at all**, since
 * registration answers on the `public` segment and a cookie written anywhere
 * else would leave a new account signed in only until its first reload.
 */
export const USER_REFRESH_COOKIE = {
  name: "__Secure-machxi.refresh",
  path: "/api/v1/user/auth",
} as const;

/**
 * The same cookie for the **staff** population, which is the other half of the
 * point above (`D15.8`, the `D15.8` security review's asymmetry finding).
 *
 * Only `dual-session.spec.ts` uses it, and it uses it in a `finally` to clear a
 * live staff refresh cookie out of a **worker-scoped** context. That clear
 * fails silently — `clearCookies` with a path that no longer matches removes
 * nothing and throws nothing — so the path it filters on is the one value in
 * this tier that must not be an inline literal drifting from its twin.
 */
export const ADMIN_REFRESH_COOKIE = {
  name: "__Secure-machxi.refresh",
  path: "/api/v1/admin/auth",
} as const;

/** The user population's current refresh token, out of a context's jar. */
export const userRefreshToken = async (
  context: BrowserContext,
): Promise<string | undefined> =>
  (await context.cookies()).find(
    (cookie) =>
      cookie.name === USER_REFRESH_COOKIE.name &&
      cookie.path === USER_REFRESH_COOKIE.path,
  )?.value;

/**
 * Every path the refresh cookie's shared name is written at, in this jar.
 *
 * {@link userRefreshToken} answers the first match and therefore only ever says
 * "a cookie landed **here**"; this says where the API put them **all**, which is
 * the assertion that fails when one is written host-wide. That is the failure
 * that matters: `__Secure-machxi.refresh` is the one name the two populations
 * share (ADR-0029's `authCookiePath`, left standing by ADR-0056), so a cookie at
 * `Path=/` would be sent to the admin segment as readily as to this one.
 */
export const refreshCookiePaths = async (
  context: BrowserContext,
): Promise<readonly string[]> =>
  (await context.cookies())
    .filter((cookie) => cookie.name === USER_REFRESH_COOKIE.name)
    .map((cookie) => cookie.path)
    .sort();

/**
 * One population's CSRF cookie, out of a context's jar (`D12.12`, moved here at
 * `D15.8` when a second spec needed it).
 *
 * Read from Playwright rather than from `document.cookie`: both names are at
 * `Path=/` and both are `Secure`, and the jar is the one place that holds them
 * for every origin in the context at once — which is what `dual-session.spec.ts`
 * puts under test. Neither app ever reads a cookie itself (ADR-0033), so a spec
 * that needs the token for a cookie-transport write reads it here.
 */
export const csrfCookie = async (
  context: BrowserContext,
  population: "admin" | "user",
): Promise<string | undefined> => {
  const name = `__Host-machxi.csrf.${population}`;

  return (await context.cookies()).find((cookie) => cookie.name === name)
    ?.value;
};

/**
 * The operator the admin half of a spec signs in as (`D12.12`, moved here at
 * `D13.9`).
 *
 * `apps/admin/e2e/support/app.ts`' constant, written out rather than imported
 * across an app boundary: that file is `apps/admin`'s, and reaching into it
 * would make a spec in this suite a diff against another app. Environment
 * first, the seeded super admin as the default, exactly as it is there.
 *
 * The email is what `impersonation.spec.ts` asserts the banner names, so it is
 * the whole record rather than only the credentials — the `D13.7` review's "one
 * value, not two literals across two suites" applied to the operator as it was
 * applied to the fixture principal.
 */
export const OPERATOR = {
  email: process.env["SEED_SUPER_ADMIN_EMAIL"] ?? "admin@machxi.local",
  password: process.env["SEED_SUPER_ADMIN_PASSWORD"] ?? "ChangeMe123!local",
};

/**
 * Signs into the admin panel in the page given, and waits for its shell.
 *
 * The wait is on the dashboard heading rather than on a URL, for the reason
 * {@link signIn} gives about this app: the boot sequence runs after `load`, so
 * an address bar that already says `/` is not yet an app. "Dashboard" is the
 * admin's word — ADR-0055 §5 is why it is not this app's.
 */
export const signInAsOperator = async (page: Page): Promise<void> => {
  await page.goto(`${ADMIN_URL}/login`);

  await page.getByLabel("Email").fill(OPERATOR.email);
  await page.getByLabel("Password").fill(OPERATOR.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(
    page.getByRole("heading", { name: "Dashboard", level: 1 }),
  ).toBeVisible();
};

/**
 * Stops the run, by name, when ADR-0020's window is spent — `D11.11`'s probe,
 * arriving in the second app it was always going to be needed in.
 *
 * The diagnosis and the mechanism are `apps/admin/e2e/support/app.ts`'s: the
 * limiter is in-memory and **global** — 300 requests in fifteen minutes for the
 * whole API — and it sits above routing, so a clear window answers `404` on a
 * path that does not exist and a spent one answers `429`. A failure here is a
 * failure of every spec, which is correct: none of them can run, and one honest
 * error at second zero is worth more than a dozen timeouts.
 *
 * **The floor is this suite's own cost, and that is the arithmetic `D12.10`
 * had to redo.** One window now carries two suites — `pnpm test:e2e` is
 * `turbo run test:e2e`, so the admin's walk and this one run back to back
 * against the same limiter — and the admin's floor of 180 can only speak for
 * the suite it guards. By the time this probe fires, the admin's share is
 * already spent, so the only question left here is whether what *remains*
 * covers this walk. Both floors together are what makes the enlarged run
 * legible when it cannot finish.
 *
 * **The two suites together no longer fit one window, and `D15.8` is where
 * that stopped being a projection.** Measured that day, each suite alone in a
 * clear window: the admin's 37 specs take it from 299 to 124, so **174**; this
 * suite's 12 take it from 299 to 164, so **134**. That is **308** against
 * ADR-0020's 300, and `pnpm test:e2e` runs them back to back through one
 * limiter (`--concurrency=1`), so the command cannot be green on a stock
 * profile however healthy every spec in it is.
 *
 * **Neither floor is fudged to hide that, and neither number is the culprit.**
 * The admin's 168 was measured at `D11.11` and its suite has not changed since
 * `D11.12`; the app underneath it has, which is where its growth came from. The
 * fix — a larger `RATE_LIMIT_GLOBAL_MAX` for the dev profile — is the one
 * `D11.6` recorded and `D11.11` left untaken, both times for the same reason:
 * the limit is ADR-0020's, and a frozen record's number is not a build step's
 * to move. So it is escalated rather than applied, and the two suites are run
 * one per window until it is answered ([`docs/plan/0015-organizations.notes.md`](../../../../docs/plan/0015-organizations.notes.md)).
 *
 * What a machine can do today without touching anything committed: restart
 * `pnpm dev --filter api` between the two, which clears an in-memory counter,
 * or set `RATE_LIMIT_GLOBAL_MAX` in its own git-ignored `.env` — the message
 * below says both.
 *
 * **`needed` is a parameter since `D13.9`, and that is the whole point of it.**
 * The default is the suite's own cost, which is the right number for the
 * worker fixture, because the fixture probes before the tier's first request.
 * A spec that probes from the *middle* of the tier must ask for what remains to
 * be spent — the suite's cost has already been partly paid by the time it runs,
 * and asserting the whole of it there aborts a perfectly healthy run with a
 * diagnosis that is exactly backwards. `D13.9`'s `security-reviewer` pass found
 * that; the parameter is the fix.
 */
export const assertApiWindowClear = async (
  page: Page,
  needed = 147,
): Promise<void> => {
  /*
   * Throttled and absent are different failures, and this is the function that
   * has to tell them apart: a stack that is not running rejects here rather
   * than answering, and reporting that as a rate limit would replace one
   * misleading diagnosis with another.
   */
  const probe = await page.request
    .get(`${API_URL}/api/v1/__rate-limit-probe`, { failOnStatusCode: false })
    .catch((cause: unknown) => {
      throw new Error(
        `The API at ${API_URL} is not answering at all — this tier runs ` +
          "against a dev stack it does not start, so bring up `pnpm " +
          "docker:up` and `pnpm dev --filter api` first. " +
          `(${cause instanceof Error ? cause.message : String(cause)})`,
      );
    });

  /*
   * `"300-in-15min"; r=127; t=806` — `r` is what is left in the window and `t`
   * is the seconds until it clears. Both are on the 404 as well as on the 429,
   * because `standardHeaders: "draft-8"` sets them before the limiter decides.
   */
  const headers = probe.headers()["ratelimit"] ?? "";
  const remaining = Number(/r=(\d+)/.exec(headers)?.[1] ?? Number.NaN);
  const resets = /t=(\d+)/.exec(headers)?.[1];

  const wait =
    resets === undefined
      ? "Wait for the window to clear and run the tier again."
      : `The window clears in ${resets}s; run the tier again after that.`;

  const because =
    "This is not a defect in the app: `pnpm test:e2e` runs both apps' suites " +
    "through one window, so a second run inside the same quarter hour — or a " +
    "run beside `pnpm test:postman`, which is 165 of its own — is what " +
    "spends it. Restarting `pnpm dev --filter api` clears the counters, which " +
    "are in memory; a machine that runs the tier often can also raise " +
    "RATE_LIMIT_GLOBAL_MAX in its own (git-ignored) .env, which changes no " +
    "committed default — ADR-0020's 300 is the schema's and stays.";

  if (probe.status() === 429) {
    throw new Error(
      `The API is refusing this run: it answered 429, so ADR-0020's global rate limit (300 requests / 15 minutes, in memory) is spent. ${wait} ${because}`,
    );
  }

  /*
   * **34 was measured, not guessed** (`D12.10`, the method `D11.11` set): a
   * full green run took the window from 227 to 193, this probe and the login
   * included. The floor sits above that, so the tier declines a run it cannot
   * finish instead of half-running it — which is the case that reads as a flake
   * in whichever spec happened to be crossing the line.
   *
   * **Moved for `D12.12`.** `dual-session.spec.ts` signs into the *admin panel*
   * in this suite's own context and reloads it, which is a second app's whole
   * boot — a login, two `GET /auth/csrf` → `POST /auth/refresh` sequences, and
   * the settings write and its restore. Measured the same way: a green run took
   * the window from 299 to 249, this probe included, so the suite costs **49**
   * and the floor moves with it rather than being left to be crossed mid-run.
   * The margin over the measurement is kept at the dozen `D12.10` chose.
   *
   * **Moved again for `D13.9`, and this is the largest single move the floor
   * has taken.** `impersonation.spec.ts` walks two apps end to end in one
   * context: an admin login and boot, a searched grid, a mint, a cross-origin
   * exchange and the customer app's own boot, a refused password change, a
   * settings write and its restore, a logout, one deliberately failed refresh,
   * and a second admin boot to prove the staff session outlived all of it.
   * Measured the same way — a green run of that spec alone took the window from
   * 226 to 197, its own probe included — so it costs **28** and the suite costs
   * **77**. The margin over the measurement is the dozen `D12.10` chose, rounded
   * up to the next ten.
   *
   * **Moved a third time for `D15.8`, and this time the whole suite was
   * re-measured rather than added to.** Two things had grown since `D13.9`
   * without the number moving: `organizations.spec.ts` arrived — it registers an
   * account, boots it twice, makes a team organization, invites the fixture
   * customer, is refused as the last owner, has the offer accepted in the
   * worker's own signed-in context, and then closes both — and `D15.5` put a
   * `GET /user/orgs` behind every protected screen, which every cold-URL case in
   * `account.spec.ts` pays. So the figure is taken from the suite and not from
   * arithmetic over its parts: a green run of all twelve specs took a clear
   * window from 299 to 164, its own probe included, so the suite costs **134**.
   * The margin over the measurement is the dozen `D12.10` chose.
   *
   * The admin's is **174** on the same day and by the same method (299 to 124,
   * 37 specs), against the 168 its own floor still states — its suite has not
   * changed since `D11.12`, so what grew is the app. **308 together**, which is
   * over ADR-0020's 300: see the header above for why that is escalated rather
   * than fixed here, and why neither floor was trimmed to make the sum work.
   */
  if (Number.isFinite(remaining) && remaining < needed) {
    throw new Error(
      `The API has ${remaining} requests left in ADR-0020's 15-minute window and what is about to run costs about ${needed - 13}, so it would fail somewhere in the middle rather than here. ${wait} ${because}`,
    );
  }
};

/**
 * The option an account is currently on, read as the enum the API stores
 * (`D12.10`, moved here at `D13.9` when a second spec needed it).
 *
 * `:checked` rather than a role query, deliberately: every other locator in
 * this tier names a control the way a customer finds it, but what has to be put
 * back afterwards is the **value** — `dark`, `lv` — and a label would make the
 * restore depend on the language the previous case left the panel in.
 */
export const chosen = async (page: Page, name: string): Promise<string> => {
  const value = await page
    .locator(`input[name="${name}"]:checked`)
    .getAttribute("value");

  if (value === null) throw new Error(`no ${name} option is checked`);

  return value;
};

/**
 * Chooses an option and waits for the account row to have taken it (`D12.10`,
 * moved here at `D13.9`).
 *
 * **The label is clicked, not the input.** `SettingsOptions` renders a native
 * radio that is `sr-only` — it *is* the control, so it is present to the
 * keyboard and to a screen reader — and the box a customer points at is the
 * `<label>` wrapped around it. The radio is still what the assertion names,
 * which is what keeps the accessible name under test.
 *
 * **And the wait is on the request, not on a timeout.** The theme rides
 * ADR-0045's coalescing writer, whose window is a second; the locale goes
 * straight through. Waiting for the `PATCH` covers both without this helper
 * knowing which is which — and without it, the round trip would assert a radio
 * the app had flipped locally and call that persistence.
 *
 * **It moved out of `account.spec.ts` at `D13.9`** because
 * `impersonation.spec.ts` needs exactly this — a settings write that lands, and
 * a restore that is not a second implementation of the same thing — and a third
 * inline copy in one tier is what `D13.7`'s review called out as two literals
 * agreeing by coincidence.
 */
export const choose = async (
  page: Page,
  name: string,
  label: string,
): Promise<void> => {
  /*
   * The role and the group together: the accessible name is what a customer
   * reads and the radio `name` is what makes the set a set. A label matched
   * outside its own group would be a control this helper drove by accident.
   */
  const radio = page
    .locator(`input[name="${name}"]`)
    .and(page.getByRole("radio", { name: label, exact: true }));

  /*
   * **Already in force is not a write, and waiting for one hangs.** A checked
   * radio fires no `change` on a second click, so no `PATCH` follows and the
   * wait below burns its full timeout — which matters most on the restore path,
   * where a forward `choose` that failed before it moved anything leaves the
   * option exactly where this call is about to ask for it.
   */
  if (await radio.isChecked()) return;

  /*
   * Registered before the click, so a fast `PATCH` cannot be missed. The status
   * is asserted after the await rather than filtered inside the predicate: a
   * rejected write would otherwise not match, and the failure would read as
   * "timed out waiting for a response" instead of naming the status the API
   * actually sent.
   */
  const patched = page.waitForResponse(
    (response) =>
      response.url().endsWith("/user/settings") &&
      response.request().method() === "PATCH",
  );

  await radio.locator("xpath=ancestor::label[1]").click();

  await expect(radio).toBeChecked();
  expect((await patched).status()).toBe(200);
};

/**
 * Endonym-free labels for the theme enum, and the lookup that refuses an
 * unknown value (`D12.10`'s table, hoisted at `D13.9`).
 *
 * **It throws rather than falling back**, which is the point: `system` is a
 * third value, and mapping an unrecognised one to "Light" on the way back would
 * silently *rewrite* the fixture account's preference instead of restoring it.
 * A restore that guesses is worse than a restore that fails loudly.
 */
export const THEME_LABELS: Record<string, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export const labelFor = (
  labels: Record<string, string>,
  value: string,
): string => {
  const label = labels[value];

  if (label === undefined) throw new Error(`no label for ${value}`);

  return label;
};
