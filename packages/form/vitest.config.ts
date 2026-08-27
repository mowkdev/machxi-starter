import { reactConfig } from "@repo/vitest-config/react";
import { defineConfig, mergeConfig } from "vitest/config";

/**
 * The form machinery's suite (`D9.5`, ADR-0036).
 *
 * `reactConfig` because this package is components — the adapters, the frame
 * and the three shells all render — and because `zod-locale.ts`'s installer is
 * driven through an i18next instance, which is what `@repo/i18n` is built for.
 */
export default mergeConfig(
  reactConfig,
  defineConfig({
    test: { setupFiles: ["./src/__tests__/support/setup.ts"] },
  }),
);
