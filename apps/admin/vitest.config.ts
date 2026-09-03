import { fileURLToPath, URL } from "node:url";

import { reactConfig } from "@repo/vitest-config/react";
import { defineConfig, mergeConfig } from "vitest/config";

import { versionDefine } from "./app-version";

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
    /*
     * The same `define` `vite.config.ts` installs, from the same module
     * (`D11.3`). Vitest reads this file and not that one, so a constant
     * declared only there is `undefined` under the runner — and the footer's
     * test would be asserting a global the suite never had.
     */
    define: versionDefine,
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
      /*
       * **Raised from fifteen to thirty at `D9.4`**, for the reason `D4.4`
       * raised the query ceiling: the load the whole suite is under, not any
       * one screen's cost. From D9 this app's machinery arrives as workspace
       * packages whose `exports` point at TypeScript source, so every worker
       * transforms them, and under `pnpm test` — where the other packages'
       * suites run alongside — the heaviest routing files crossed fifteen
       * seconds while passing comfortably when the app's suite runs alone.
       * The gap over `asyncUtilTimeout` is preserved, or a genuinely failing
       * `findBy*` races this and reports "Test timed out" instead of naming
       * the element it could not find.
       */
      testTimeout: 30_000,
      env: {
        VITE_API_URL: "http://api.test",
        /*
         * Pinned, for the reason `VITE_API_URL` is (ADR-0064 §1): the device
         * keys every suite reads are built from it, so a variable read from
         * outside the repository would be invisible to Turbo's hash and would
         * move the key literals this suite asserts on. `machxi` is the
         * schema's own default, so nothing about the pin changes behaviour.
         */
        VITE_APP_ID: "machxi",
        /*
         * Pinned off, for the reason `VITE_API_URL` is pinned at all (`D7.6`,
         * ADR-0046 §10): a variable read from outside the repository is
         * invisible to Turbo's hash, and this one would silently accent every
         * assertion by accessible name in the suite. The one test that wants
         * the lens asks `renderApp` for it, which needs no environment.
         */
        VITE_I18N_PSEUDO: "false",
        /*
         * The customer app's origin (`D13.8`), pinned for the reason
         * `VITE_API_URL` is: `shared/config` parses it at module load and the
         * schema requires it, so a suite that read this from outside the
         * repository would fail on a machine without an `apps/admin/.env` and
         * would be invisible to Turbo's hash on one with it. The value is a
         * hostname no test resolves — the Impersonate action's assertion is on
         * the URL it hands to `window.open`, which is never fetched.
         */
        VITE_CUSTOMER_APP_URL: "http://customer.test",
      },
    },
  }),
);
