import { config } from "@repo/eslint-config";

/**
 * ADR-0004: `process.env` is read in exactly one module of this package —
 * `src/tooling/env.ts` — which the CLI entry points (`migrate.ts`, the seed
 * runner, `drizzle.config.ts`) share. The library surface (`src/index.ts` and
 * everything it exports) takes its connection string as an argument, so
 * importing `@repo/db` never reads the environment.
 *
 * ADR-0005 §Scope: these CLI scripts write plain lines to stdout instead of
 * `console.*`; `no-console` therefore stays on everywhere.
 *
 * @type {import("eslint").Linter.Config}
 */
export default [
  ...config,
  {
    files: ["src/**/*.ts", "seeds/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Read the environment through src/tooling/env.ts (ADR-0004).",
        },
      ],
    },
  },
];
