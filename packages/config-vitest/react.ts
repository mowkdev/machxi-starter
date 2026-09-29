import { defineConfig } from "vitest/config";

/**
 * Component tests (ADR-0021) — the jsdom suites: every workspace that imports
 * this config, both SPAs and `@repo/ui` among them. Consumers must declare `jsdom` themselves — Vitest resolves the
 * environment package from the project root, not from this package.
 *
 * **Coverage is never gated, as in `node.ts`, and here it is
 * collected only when asked for** — `pnpm test:unit --filter admin --
 * --coverage` prints the same summary — where `node.ts` collects it on every
 * run (ADR-0074, Consequences, as amended at `D28.10`). `D28.10` measured the
 * admin tier twice each way on one idle machine: 127.1s and 125.4s with v8
 * instrumenting every run, 92.3s and 92.7s without — a quarter of the gate's
 * slowest link, spent on a summary no green run is read for. The block stays
 * written out so that the flag alone brings the summary back.
 */
export const reactConfig = defineConfig({
  test: {
    environment: "jsdom",
    // Parallel `test:unit` runs many jsdom tiers; cores − 1 each overran Vitest's fixed 60s worker start.
    maxWorkers: "50%",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.turbo/**"],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      enabled: false,
      provider: "v8",
      reporter: ["text-summary"],
    },
  },
});

export default reactConfig;
