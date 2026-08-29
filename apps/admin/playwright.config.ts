import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

/*
 * The root `.env`, loaded here because nothing else will (ADR-0026's D2.1
 * lesson: an undeclared variable does not fail loudly, it defaults quietly).
 *
 * Declaring `SEED_SUPER_ADMIN_*` on the turbo task makes them *passable*, not
 * *present* — Turbo does not read `.env` and neither does Playwright, so on a
 * machine seeded with anything but the example values the suite would fall
 * back to the defaults in `e2e/support/app.ts` and fail on a login timeout,
 * blaming the app for a configuration miss. `packages/db`'s tooling loads the
 * same file for the same reason.
 *
 * Non-overriding: a variable already in the environment wins, which is what
 * lets CI pass credentials without a file.
 */
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // No root `.env` — the defaults and the ambient environment carry it.
}

/**
 * The browser tier (ADR-0052 §The browser tier, `D10.4`; the slot ADR-0036
 * §What-is-deferred reserved).
 *
 * **It exists because five deliverables closed with items marked "accepted by
 * the operator rather than machine-verified".** Its scope is exactly that
 * standing walk and nothing speculative: what jsdom cannot see — sticky
 * positioning, scroll containment, a handle that has to be *visible*, a bar
 * that appears only while a route is unresolved. MSW stays the component
 * tier's boundary; this tier is not a second place to test what jsdom already
 * proves.
 *
 * **It runs against the dev stack, not a fixture.** The API and Postgres are
 * up and seeded (`pnpm docker:up`, `pnpm db:setup`, `pnpm db:seed -- --dev`),
 * which is why every spec asserts **invariants rather than row counts**: a dev
 * database drifts with use, and a suite that counted rows would be red for
 * reasons that have nothing to do with the code. There is no `webServer` here
 * on purpose — starting a stack this tier does not own would hide which half
 * was broken when it fails.
 *
 * **One worker, and one browser context inside it** (`support/fixtures.ts`).
 * The specs share one database and one operator account, and ADR-0052's data
 * rules say a spec cleans up what it writes; two workers racing over the same
 * rows would make cleanup a lottery. The single context is a harder
 * requirement than tidiness: ADR-0018 rotates refresh tokens, so a session
 * cannot be copied into a second context without spending a token that context
 * will need.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env["CI"]),
  retries: 0,
  reporter: [["list"]],
  expect: {
    /*
     * Generous, because every wait here is a real network round trip to a real
     * API — and stingy timeouts are how a browser suite earns the reputation
     * this one has to avoid.
     */
    timeout: 10_000,
  },
  timeout: 60_000,
  use: {
    /*
     * The dev server's address, overridable for a preview build or another
     * port. Not a new configuration decision (ADR-0004): it is a test-runner
     * input with a default, and nothing in the app reads it.
     */
    baseURL: process.env["E2E_BASE_URL"] ?? "http://localhost:3001",
    /*
     * Worth knowing before a trace leaves the machine: Playwright records
     * `fill()` arguments verbatim, so a failed sign-in's trace contains the
     * operator password in plaintext. `test-results/` is git-ignored for that
     * reason; a trace shared with anyone should come from a throwaway account.
     */
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
