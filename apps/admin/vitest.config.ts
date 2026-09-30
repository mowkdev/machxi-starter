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
     *
     * **Built from nothing set, not from `process.env`** (`D32.2`), for the
     * reason `env` below pins `VITE_API_URL`: a label read from the shell
     * would be invisible to Turbo's hash for this task and would move what
     * the footer's suite asserts. Unset is `dev`, which is what every local
     * build shows.
     */
    define: versionDefine({}),
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    test: {
      setupFiles: ["@repo/app-kit/testing/setup"],
      /*
       * Vitest's default is 5s, which is exactly Testing Library's
       * `asyncUtilTimeout` in `@repo/app-kit/testing/setup` — so a genuinely failing
       * `findBy*` raced the test timeout and reported "Test timed out" instead
       * of naming the element it could not find. The ceiling has to sit above
       * the query's, or the diagnostic is the first thing lost.
       */
      /*
       * **Thirty, and `D14.9` is where that was measured rather than assumed.**
       *
       * `D9.4` raised it from fifteen for the load the whole suite is under
       * rather than any one screen's cost: from D9 this app's machinery arrives
       * as workspace packages whose `exports` point at TypeScript source, every
       * worker transforms them, and under `pnpm test` the heaviest routing
       * files crossed fifteen seconds. ADR-0062 §Consequences said project
       * references would let that be revisited "on measurement rather than on
       * hope", and `D14.9` measured it: **the answer was no.**
       *
       * Two full `pnpm test` runs at fifteen were green, and the numbers are
       * why green was not enough. The slowest single test came out at 4.3s in
       * one run and 9.6s in the other — a 2.2× spread on one idle machine,
       * leaving about 1.6× of headroom under a fifteen-second ceiling on a
       * developer's laptop, and CI's two-core runner is slower than that. A
       * ceiling that close turns a slow morning into a red gate, which is a
       * far worse failure than fifteen extra seconds spent proving a hang.
       *
       * **The premise did not survive the measurement either.** Project
       * references make `check-types` incremental; they change nothing about
       * what Vitest transforms, and the transform is what `D9.4` was paying
       * for. Faster type-checking was never going to make this number smaller.
       *
       * It does not go lower for a second reason that is independent of load:
       * the gap over Testing Library's five-second `asyncUtilTimeout` in
       * `@repo/app-kit/testing/setup` is what keeps a genuinely failing
       * `findBy*` naming the element it could not find instead of reporting
       * "Test timed out".
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
