import { fileURLToPath, URL } from "node:url";

import { reactConfig } from "@repo/vitest-config/react";
import { defineConfig, mergeConfig } from "vitest/config";

/**
 * The admin suite (ADR-0036): one tier, Vitest + Testing Library + jsdom, with
 * MSW intercepting at the HTTP boundary. No live-API tier in D3.
 *
 * `env` pins `VITE_API_URL` inside the repository rather than letting it come
 * from a gitignored `.env` or the ambient environment. That is what keeps the
 * task honestly cacheable under ADR-0026: the suite consumes nothing outside
 * the tree, so its result is a pure function of the tree. A value read from
 * outside would be invisible to Turbo's hash — the pre-D2.1 cache-lie class.
 *
 * The `@` alias has to be declared here as well as in `vite.config.ts`: vitest
 * reads this file instead of that one, so an alias declared only there
 * type-checks and then fails to resolve under the runner.
 */
export default mergeConfig(
  reactConfig,
  defineConfig({
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    test: {
      setupFiles: ["./src/test/setup.ts"],
      /*
       * Vitest's default is 5s, which is exactly Testing Library's
       * `asyncUtilTimeout` in `src/test/setup.ts` — so a genuinely failing
       * `findBy*` raced the test timeout and reported "Test timed out" instead
       * of naming the element it could not find. The ceiling has to sit above
       * the query's, or the diagnostic is the first thing lost.
       */
      testTimeout: 15_000,
      env: {
        VITE_API_URL: "http://api.test",
        /*
         * Pinned off, for the reason `VITE_API_URL` is pinned at all (`D7.6`,
         * ADR-0046 §10): a variable read from outside the repository is
         * invisible to Turbo's hash, and this one would silently accent every
         * assertion by accessible name in the suite. The one test that wants
         * the lens asks `renderApp` for it, which needs no environment.
         */
        VITE_I18N_PSEUDO: "false",
      },
    },
  }),
);
