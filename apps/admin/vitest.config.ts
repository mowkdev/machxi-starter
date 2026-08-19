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
      env: {
        VITE_API_URL: "http://api.test",
      },
    },
  }),
);
