import { reactConfig } from "@repo/vitest-config/react";
import { defineConfig, mergeConfig } from "vitest/config";

/**
 * The grid's suite (`D9.4`, ADR-0036).
 *
 * `reactConfig` because this package is components: the grid renders, and its
 * suite drives it through Testing Library exactly as the app's did.
 */
export default mergeConfig(
  reactConfig,
  defineConfig({
    test: { setupFiles: ["./src/__tests__/support/setup.ts"] },
  }),
);
