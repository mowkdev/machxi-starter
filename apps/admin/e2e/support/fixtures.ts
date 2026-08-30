import { test as base, type Page } from "@playwright/test";

import { assertApiWindowClear, signIn } from "./app";

/**
 * One signed-in browser context for the whole run (`D10.4`).
 *
 * **Playwright's `storageState` cannot carry this app's session, and the
 * reason is a decision rather than a defect.** ADR-0018 rotates the refresh
 * token: each successful refresh issues a new cookie and retires the one it
 * came from. A saved state holds exactly one of those, so the first context to
 * boot from it spends the token and every later context replays a spent one —
 * which the API correctly treats as a *failed* refresh. Five of those trip
 * ADR-0020's refresh limiter (5 per 15 minutes per IP, successful ones
 * skipped) and the whole tier is locked out for a quarter of an hour, for a
 * reason that has nothing to do with the code under test.
 *
 * So the session lives where a session is supposed to live: in one browser,
 * for the length of the run. The fixture is **worker-scoped**, the config runs
 * one worker, and the rotation chain therefore stays inside a single context —
 * exactly as it does for an operator who signs in once in the morning.
 *
 * A healthy run costs **one login**, well inside ADR-0020's ten-per-fifteen
 * budget, and every refresh after it succeeds and is skipped by the limiter.
 */
/** No test-scoped fixtures; `app` is the only one and it is worker-scoped. */
type NoTestFixtures = Record<never, never>;

export const test = base.extend<NoTestFixtures, { app: Page }>({
  app: [
    async ({ browser }, use) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      /*
       * Before the login, because a spent rate-limit window makes the login
       * itself the symptom (`D11.11`). See `assertApiWindowClear`: one
       * request buys an error that names ADR-0020 instead of thirty-four
       * timeouts that name nothing.
       */
      await assertApiWindowClear(page);

      await signIn(page);
      await use(page);

      await context.close();
    },
    { scope: "worker" },
  ],
});

export { expect } from "@playwright/test";
