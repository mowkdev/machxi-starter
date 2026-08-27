import { reactConfig } from "@repo/vitest-config/react";
import { defineConfig, mergeConfig } from "vitest/config";

/**
 * The package's suite (`D9.1`, ADR-0036, ADR-0051).
 *
 * **`reactConfig`, and therefore jsdom, even though nothing here renders** —
 * because the environment selects axios's *transport*, not just the DOM.
 * axios picks its adapter by feature detection: `XMLHttpRequest` under a
 * browser environment, Node's `http` otherwise. Under `node` this suite would
 * certify the `http` adapter — a path the shipped client never takes — and
 * `withCredentials: true`, which is the whole basis of the cookie session and
 * the single-flight refresh (ADR-0029, ADR-0033), is a no-op there. These
 * tests ran under the admin's jsdom before the move and must keep running
 * under it, or the extraction quietly changed what they prove.
 *
 * `setupFiles` carries the MSW lifecycle, which is what lets the real client —
 * interceptors, envelope unwrap, CSRF header, single-flight refresh — run in
 * every test without a socket, keeping the task cacheable under ADR-0026.
 */
export default mergeConfig(
  reactConfig,
  defineConfig({
    test: { setupFiles: ["./src/__tests__/support/setup.ts"] },
  }),
);
