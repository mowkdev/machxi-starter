import { defineConfig } from "vitest/config";

const alwaysExclude = ["**/node_modules/**", "**/dist/**", "**/.turbo/**"];

/**
 * Unit tests (ADR-0021): pure functions and fake repositories, no I/O.
 * Fully parallel. `*.int.test.ts` files are excluded — they belong to
 * `integrationConfig` and the separate `test:int` script.
 *
 * **Coverage is reported and never gated** (ADR-0073 §6 as carried by
 * ADR-0074). A text summary on every unit run is what says which slices are
 * thin, and here it costs little; the jsdom suites collect it only on
 * `--coverage`, where it cost a quarter of the slowest link (`react.ts`); a threshold chosen before
 * the number is measured is a number that gets edited on the first red run, so
 * a floor stays a later decision taken on a measurement. The block is written
 * out here and in `react.ts` rather than shared through a constant: inside
 * `defineConfig` the literal gets its contextual type, and a hoisted object
 * would have to be hand-typed against Vitest's options to keep it.
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
      enabled: true,
      provider: "v8",
      reporter: ["text-summary"],
    },
  },
});

/**
 * Integration tests (ADR-0021): real Postgres via `DATABASE_URL_TEST`.
 * Serial per file so that truncation between files cannot race. No coverage:
 * instrumenting a suite that talks to a database measures the harness.
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
