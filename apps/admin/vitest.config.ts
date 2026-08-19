import { fileURLToPath, URL } from "node:url";

import { reactConfig } from "@repo/vitest-config/react";
import { defineConfig, mergeConfig } from "vitest/config";

/*
 * The `@` alias has to be declared here as well as in `vite.config.ts` — vitest
 * reads this file instead of that one, so an alias declared only there
 * type-checks and then fails to resolve under the test runner.
 */
export default mergeConfig(
  reactConfig,
  defineConfig({
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  }),
);
