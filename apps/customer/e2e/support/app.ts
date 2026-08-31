import { expect, type Locator, type Page } from "@playwright/test";

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
 * Where the API answers, for the one request this suite makes directly.
 *
 * Shared with the admin's tier on purpose, and it is the variable that shows
 * why `E2E_CUSTOMER_BASE_URL` is not: there is one API, so there is one
 * address, while two apps mean two ports.
 */
const API_URL = process.env["E2E_API_URL"] ?? "http://localhost:4000";

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
 * **The admin's floor of 180 was not raised, and that is a decision.** It
 * would have to be, if the two suites' costs together crossed 300 — they do
 * not, at about 204 — and raising it means a diff under `apps/admin`, which
 * this deliverable spends nothing on by design (the plan's §Definition-of-done
 * item 2).
 */
export const assertApiWindowClear = async (page: Page): Promise<void> => {
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
    "run beside `pnpm test:postman`, which is another hundred — is what " +
    "spends it.";

  if (probe.status() === 429) {
    throw new Error(
      `The API is refusing this run: it answered 429, so ADR-0020's global rate limit (300 requests / 15 minutes, in memory) is spent. ${wait} ${because}`,
    );
  }

  /*
   * **34 is measured, not guessed** (`D12.10`, the method `D11.11` set): a full
   * green run took the window from 227 to 193, this probe and the login
   * included. The floor sits above that, so the tier declines a run it cannot
   * finish instead of half-running it — which is the case that reads as a flake
   * in whichever spec happened to be crossing the line.
   *
   * Together with the admin's 168 and its own probe, `pnpm test:e2e` spends
   * about 204 of ADR-0020's 300 — so a clear window carries the enlarged run
   * whole, and a second run inside the same quarter hour does not.
   */
  const NEEDED = 45;

  if (Number.isFinite(remaining) && remaining < NEEDED) {
    throw new Error(
      `The API has ${remaining} requests left in ADR-0020's 15-minute window and a full run of the customer tier costs about 34, so it would fail somewhere in the middle rather than here. ${wait} ${because}`,
    );
  }
};
