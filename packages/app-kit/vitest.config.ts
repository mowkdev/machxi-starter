import { reactConfig } from "@repo/vitest-config/react";
import { defineConfig, mergeConfig } from "vitest/config";

/**
 * The kit's suite (ADR-0062 §1, ADR-0036).
 *
 * `reactConfig` because this package is components: the providers, the layouts
 * and the boundary all render, and the suite drives them through Testing
 * Library exactly as the apps' suites did before the composition moved here.
 */
export default mergeConfig(
  reactConfig,
  defineConfig({
    test: { setupFiles: ["./src/__tests__/support/setup.ts"] },
  }),
);
