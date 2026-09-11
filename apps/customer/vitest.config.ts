import { fileURLToPath, URL } from "node:url";

import { reactConfig } from "@repo/vitest-config/react";
import { defineConfig, mergeConfig } from "vitest/config";

import { versionDefine } from "./app-version";

/**
 * The customer suite (ADR-0036 as carried by ADR-0055 §2): one tier, Vitest +
 * Testing Library + jsdom, with MSW intercepting at the HTTP boundary from
 * `D12.2`. No live-API tier.
 *
 * `env` pins `VITE_API_URL` inside the repository rather than letting it come
 * from a gitignored `.env` or the ambient environment. That is what keeps the
 * task honestly cacheable under ADR-0026: the suite consumes nothing outside
 * the tree, so its result is a pure function of the tree. A value read from
 * outside would be invisible to Turbo's hash.
 *
 * The `@` alias has to be declared here as well as in `vite.config.ts`: vitest
 * reads this file instead of that one, so an alias declared only there
 * type-checks and then fails to resolve under the runner. So does `define` —
 * see `app-version.ts`.
 */
export default mergeConfig(
  reactConfig,
  defineConfig({
    define: versionDefine,
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    test: {
      setupFiles: ["@repo/app-kit/testing/setup"],
      /*
       * Thirty, matching the admin's, and left there at `D14.9` on the
       * measurement that file writes down: fifteen is green but with only
       * ~1.6× of headroom over the slowest test on an idle machine, and
       * project references do not make Vitest transform less. The reason the
       * two agree at all is the one that file also writes down rather than
       * imitation — the ceiling has to sit above Testing Library's
       * five-second `asyncUtilTimeout` in `@repo/app-kit/testing/setup`, or a
       * genuinely failing `findBy*` races the test timeout and reports "Test
       * timed out" instead of naming the element it could not find.
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
         * Pinned off, for the reason `VITE_API_URL` is pinned at all
         * (ADR-0046 §10): a variable read from outside the repository is
         * invisible to Turbo's hash, and this one would silently accent every
         * assertion by accessible name in the suite. The one suite that wants
         * the lens asks `renderApp` for it, which needs no environment.
         */
        VITE_I18N_PSEUDO: "false",
        /*
         * Pinned on, for the reason the two above are pinned at all
         * (`D15.6`, ADR-0067 §6): a variable read from outside the repository
         * is invisible to Turbo's hash, and this one decides whether
         * `/register` and the sign-in screen's link exist — so a developer
         * with it set to `false` in their shell would watch this suite fail on
         * addresses that are perfectly fine. `true` is the schema's own
         * default, so nothing about the pin changes behaviour, and the one
         * suite that wants it off asks `renderApp` for it.
         */
        VITE_FEATURE_USER_REGISTRATION: "true",
        /*
         * Pinned off, the schema's own default, for the reason every pin here
         * exists (ADR-0072 §4): a developer with it set in their shell would
         * otherwise change what `/login` draws in every suite that visits it.
         * The cases that want the button ask `renderApp` for it.
         */
        VITE_FEATURE_GOOGLE_SIGN_IN: "false",
      },
    },
  }),
);
