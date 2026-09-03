import { setupServer } from "msw/node";

/**
 * The one MSW server every SPA suite shares (ADR-0036), extracted at `D14.8`
 * (ADR-0062 §1).
 *
 * Deliberately started with **no handlers**: a suite's handlers are its own,
 * declared per file, and a default set here would make every test's network
 * depend on what some other test needed. `setup.ts` runs it with
 * `onUnhandledRequest: "error"`, so a request nothing answered fails the test
 * that made it rather than hanging it.
 *
 * Module-level, because `msw/node` intercepts the process's HTTP stack and a
 * second instance would fight the first. Each app's vitest run is its own
 * process, so the sharing is textual rather than actual.
 */
export const server = setupServer();
