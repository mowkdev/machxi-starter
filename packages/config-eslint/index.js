import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier";
import turboPlugin from "eslint-plugin-turbo";
import tseslint from "typescript-eslint";
import onlyWarn from "eslint-plugin-only-warn";

/**
 * A shared ESLint configuration for the repository.
 */
export const config = defineConfig(
  /*
   * `dist/` is a build; `dist-types/` is the declarations-only emit project
   * references write (`D14.9`, ADR-0062 §3). Both are generated and both are
   * gitignored, and linting a `.d.ts` nobody wrote is noise at best — at
   * worst it is the rule set arguing with the compiler about its own output.
   */
  globalIgnores(["dist/**", "dist-types/**"]),
  js.configs.recommended,
  eslintConfigPrettier,
  tseslint.configs.recommended,
  {
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
      // ADR-0005: structured logging only, never console.*
      "no-console": "error",
      // Match `noUnusedLocals` / `noUnusedParameters` in the shared tsconfig
      // (ADR-0002), which treat a leading underscore as "deliberately unused".
      // Without this the two tools disagree about the same line.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    plugins: {
      onlyWarn,
    },
  },
);
