import { defineConfig } from "vitest/config";

/**
 * Component tests (ADR-0021) for `@repo/ui` and the `admin` SPA.
 * Consumers must declare `jsdom` themselves — Vitest resolves the
 * environment package from the project root, not from this package.
 */
export const reactConfig = defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.turbo/**"],
    clearMocks: true,
    restoreMocks: true,
  },
});

export default reactConfig;
