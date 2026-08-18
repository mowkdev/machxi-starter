import { config } from "@repo/eslint-config";

/**
 * ADR-0023: `@repo/contracts` must stay browser-safe and depend on nothing
 * internal. `@types/node` is in scope so that `vitest.config.ts` type-checks,
 * which means TypeScript alone would not object to a `node:crypto` import
 * here — this rule is what actually keeps one out.
 *
 * @type {import("eslint").Linter.Config}
 */
export default [
  ...config,
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*"],
              message: "Contracts must not use Node built-ins (ADR-0023).",
            },
            {
              group: ["@repo/*"],
              message: "Contracts may depend only on zod (ADR-0023).",
            },
          ],
        },
      ],
    },
  },
];
