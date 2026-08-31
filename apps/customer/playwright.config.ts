import { defineConfig, devices } from "@playwright/test";

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
