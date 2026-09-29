import { reactConfig } from "@repo/vitest-config/react";
import { defineConfig, mergeConfig } from "vitest/config";

/**
 * The account package's suite (`D22.2`, ADR-0077 §4, ADR-0036).
 *
 * `reactConfig` because this package is components and hooks: the settings
 * gate, the three preference cards and the forms all render, and the suite
 * drives them through Testing Library over an MSW server of its own — the
 * shape the apps' suites had before the code moved here.
 */
export default mergeConfig(
  reactConfig,
  defineConfig({
    test: { setupFiles: ["./src/__tests__/support/setup.ts"] },
  }),
);
