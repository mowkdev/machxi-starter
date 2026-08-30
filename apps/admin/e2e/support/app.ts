import { expect, type Locator, type Page } from "@playwright/test";

/**
 * What every spec needs and no spec should re-derive (`D10.4`).
 *
 * Sign-in, the two grids, and the handful of locators the walk keeps reaching
 * for. Everything here is named by **role and accessible name**, the same
 * discipline ADR-0036 imposes on the component tier — a control this file
 * cannot name is one a screen reader cannot name either.
 */

/**
 * The operator the suite signs in as (ADR-0052 §The browser tier).
 *
 * Environment first, the seeded super admin as the default — so a machine with
 * a different seed passes its own credentials in and nothing here is a secret
 * or a fixture. These are the same variables `pnpm db:setup` seeds from, which
 * is what makes "the default" a fact rather than a guess.
 */
const CREDENTIALS = {
  email: process.env["SEED_SUPER_ADMIN_EMAIL"] ?? "admin@machxi.local",
  password: process.env["SEED_SUPER_ADMIN_PASSWORD"] ?? "ChangeMe123!local",
};

/**
 * The signed-in operator's address, for the one claim that needs it
 * (`D11.11`): the account menu's principal block shows who is signed in.
 *
 * Exported from the same constant the sign-in uses rather than written
 * out again, so a machine seeded from its own `.env` asserts about the
 * account it actually has — the whole reason `CREDENTIALS` reads the
 * environment first.
 */
export const OPERATOR_EMAIL = CREDENTIALS.email;

/**
 * Signs in and waits for the shell.
 *
 * The wait is on the dashboard heading rather than on a URL: the boot sequence
 * is `GET /auth/csrf` → `POST /auth/refresh` before anything renders
 * (ADR-0033), so an address bar that already says `/` is not yet an app.
 */
export const signIn = async (page: Page): Promise<void> => {
  await page.goto("/login");

  await page.getByLabel("Email").fill(CREDENTIALS.email);
  await page.getByLabel("Password").fill(CREDENTIALS.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(
    page.getByRole("heading", { name: "Dashboard", level: 1 }),
  ).toBeVisible();
};

/** The two shipped grids, which every layout claim is made about twice. */
export const GRIDS = [
  { name: "Staff", path: "/staff" },
  { name: "Users", path: "/users" },
] as const;

/** The one scroll container ADR-0037 allows a grid page. */
export const scrollPane = (page: Page): Locator =>
  page.locator('[data-slot="grid-scroll"]');

export const grid = (page: Page): Locator => page.getByRole("table");

/** The static footer of ADR-0037's budget, by its landmark name. */
export const pager = (page: Page): Locator =>
  page.getByRole("navigation", { name: "Pagination" });

/** Waits for a grid to have rendered rows — never asserting how many. */
export const waitForRows = async (page: Page): Promise<void> => {
  await expect(page.locator("tbody tr").first()).toBeVisible();
};

/**
 * Where the API answers, for the one request this suite makes directly.
 *
 * A test-runner input with a default, not a configuration decision — the
 * same standing `E2E_BASE_URL` has in `playwright.config.ts`, and for the
 * same reason: nothing in the app reads it, so ADR-0004's ceremony would be
 * recording a fact about a test harness in the app's own schema.
 */
const API_URL = process.env["E2E_API_URL"] ?? "http://localhost:4000";

/**
 * Stops the run, by name, when ADR-0020's window is spent (`D11.11`).
 *
 * **The flake `D11.1`–`D11.5` each logged as "the API is not reachable",
 * diagnosed at `D11.6` and answered here.** This tier deliberately owns no
 * `webServer`: it runs against a long-lived dev API whose rate limiter is
 * in-memory and global — 300 requests in fifteen minutes — so a full run
 * plus a second one, or a run beside `pnpm test:postman`, exhausts the
 * window. Every spec after that point fails in the fixture, waiting thirty
 * seconds for a login form the API will not let the app boot, and the
 * report blames the app for a limit doing its job.
 *
 * So the tier asks first, and the ask is one request against a path that
 * does not exist: the limiter sits **above routing**, so a clear window
 * answers `404` and a spent one answers `429` — which is the `curl` the
 * `D11.6` diagnosis turned on, promoted into the suite. It is the second of
 * the two fixes that step recorded and left for this one; the first — a
 * larger `RATE_LIMIT_GLOBAL_MAX` for the dev profile — is still available
 * and still ADR-0020's to give, and is not needed to make a throttled run
 * *legible*, which is what was actually costing time.
 *
 * A failure here is a failure of every spec, which is correct: none of them
 * can run, and one honest error at second zero is worth more than
 * thirty-four timeouts.
 */
export const assertApiWindowClear = async (page: Page): Promise<void> => {
  /*
   * **Throttled and absent are different failures, and this is the function
   * that has to tell them apart.** A stack that is not running rejects here
   * rather than answering, and reporting that as a rate limit would replace
   * one misleading diagnosis with another — which is the whole defect this
   * probe exists to end. So the reject is caught and named: the tier owns no
   * `webServer` (see `playwright.config.ts`), so "start the stack" is a real
   * instruction rather than a shrug.
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
   * `"300-in-15min"; r=127; t=806` — `r` is what is left in the window and
   * `t` is the seconds until it clears. Both are on the 404 as well as on
   * the 429, because `standardHeaders: "draft-8"` sets them before the
   * limiter decides.
   */
  const headers = probe.headers()["ratelimit"] ?? "";
  const remaining = Number(/r=(\d+)/.exec(headers)?.[1] ?? Number.NaN);
  const resets = /t=(\d+)/.exec(headers)?.[1];

  const wait =
    resets === undefined
      ? "Wait for the window to clear and run the tier again."
      : `The window clears in ${resets}s; run the tier again after that.`;

  const because =
    "This is not a defect in the app: running the tier twice inside one " +
    "window — or beside `pnpm test:postman`, which is another hundred — " +
    "is what spends it.";

  if (probe.status() === 429) {
    throw new Error(
      `The API is refusing this run: it answered 429, so ADR-0020's global rate limit (300 requests / 15 minutes, in memory) is spent. ${wait} ${because}`,
    );
  }

  /*
   * **A window that is merely *low* is the case that kept looking like a
   * defect.** A spent window fails the first spec and is at least obvious;
   * a window with sixty requests left passes this probe, runs two thirds of
   * the tier and then collapses in the middle, which reads as a flake in
   * whichever spec happened to be crossing the line. So the budget is
   * checked rather than only the refusal.
   *
   * **168 is measured, not guessed** (`D11.11`): a full green run took the
   * window from 295 to 127. The floor is set above that, so the tier
   * declines a run it cannot finish instead of half-running it.
   */
  const NEEDED = 180;

  if (Number.isFinite(remaining) && remaining < NEEDED) {
    throw new Error(
      `The API has ${remaining} requests left in ADR-0020's 15-minute window and a full run of this tier costs about 168, so it would fail somewhere in the middle rather than here. ${wait} ${because}`,
    );
  }
};
