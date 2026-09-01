import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

/*
 * The root `.env`, for `SEED_SUPER_ADMIN_*` (`D12.12`).
 *
 * See the note below: this config deliberately had no `.env` load, because
 * every spec signed in as a `--dev` fixture whose password is a committed
 * constant. `dual-session.spec.ts` signs into the **admin panel** as well, in
 * the same browser context, which is the only way to walk ADR-0056's claim —
 * so the precondition that made the absence right has changed. Turbo declares
 * `SEED_SUPER_ADMIN_*` on `test:e2e`, which makes them passable and not
 * present; nothing but this line reads the file.
 *
 * Non-overriding, so a variable already in the environment wins.
 */
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // No root `.env` — the defaults and the ambient environment carry it.
}

/**
 * The customer app's browser tier (`D12.10`; ADR-0052 §The browser tier, as
 * ADR-0055 §2 carries it — this app is tested exactly as the admin is).
 *
 * **A second Playwright project rather than a second `testDir` in the admin's
 * config**, and the reason is a deliverable rule rather than a preference:
 * §Definition-of-done item 2 says `git diff` for `apps/admin` is empty across
 * D12, so the customer's specs cannot be added to a file that app owns. Two
 * configs is also what the tier already implies — the two apps answer on two
 * ports, boot two sessions and sign in as two populations — and `pnpm test:e2e`
 * is `turbo run test:e2e`, so the workspace's own task graph is what makes the
 * pair one tier.
 *
 * **No root `.env` load, which is the one line the admin's config has and this
 * one does not.** That file exists there to carry `SEED_SUPER_ADMIN_*`, whose
 * values are per-machine secrets. This suite signs in as a `--dev` fixture
 * whose password is a committed constant (`packages/db/seeds/dev/fixtures.ts`),
 * so there is nothing outside the repository for it to read and a `.env` load
 * would be ceremony around a file it does not need.
 *
 * **Amended 2026-09-01 (`D12.12`): it loads it now.** ADR-0056's claim is that
 * two apps in one browser stop sharing CSRF state, and the only honest way to
 * walk that is to sign into **both** — so `dual-session.spec.ts` needs the
 * staff credentials after all. The reasoning above was right about every spec
 * that existed when it was written; what changed is the suite, not the
 * argument. The load is at the top of this file, for the reasons the admin's
 * config gives.
 *
 * Everything else is the admin config's, for the reasons written there and not
 * repeated here: no `webServer` (the tier runs against a dev stack it does not
 * own, so a failure names the half that broke), one worker and one context
 * (ADR-0018 rotates refresh tokens, so a session cannot be copied), retries
 * off, and traces retained only on failure because `fill()` records its
 * argument verbatim.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env["CI"]),
  retries: 0,
  reporter: [["list"]],
  expect: {
    /* Generous: every wait here is a real round trip to a real API. */
    timeout: 10_000,
  },
  timeout: 60_000,
  use: {
    /*
     * **`E2E_CUSTOMER_BASE_URL`, not `E2E_BASE_URL`.** Both apps' `test:e2e`
     * tasks receive the same environment from Turbo, so a shared variable
     * would point *both* suites at one address the moment anyone set it —
     * which is precisely the misconfiguration a per-app override exists to
     * make possible. The default is ADR-0055 §1's port, and nothing in the app
     * reads it, so this is a test-runner input rather than an ADR-0004
     * configuration decision.
     */
    baseURL: process.env["E2E_CUSTOMER_BASE_URL"] ?? "http://localhost:3002",
    trace: "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
