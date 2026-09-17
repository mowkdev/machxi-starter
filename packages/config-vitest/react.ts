import { defineConfig } from "vitest/config";

/**
 * Component tests (ADR-0021) for `@repo/ui` and the `admin` SPA.
 * Consumers must declare `jsdom` themselves — Vitest resolves the
 * environment package from the project root, not from this package.
 *
 * Coverage is reported and never gated, on `node.ts`'s reasoning.
 */
export const reactConfig = defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.turbo/**"],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["text-summary"],
    },
  },
});

export default reactConfig;
