import { defineConfig } from "vitest/config";

const alwaysExclude = ["**/node_modules/**", "**/dist/**", "**/.turbo/**"];

/**
 * Unit tests (ADR-0021): pure functions and fake repositories, no I/O.
 * Fully parallel. `*.int.test.ts` files are excluded — they belong to
 * `integrationConfig` and the separate `test:int` script.
 */
export const nodeConfig = defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: [...alwaysExclude, "**/*.int.test.ts"],
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.int.test.ts"],
    },
  },
});

/**
 * Integration tests (ADR-0021): real Postgres via `DATABASE_URL_TEST`.
 * Serial per file so that truncation between files cannot race.
 */
export const integrationConfig = defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.int.test.ts", "test/**/*.int.test.ts"],
    exclude: alwaysExclude,
    pool: "forks",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    clearMocks: true,
    restoreMocks: true,
  },
});

export default nodeConfig;
