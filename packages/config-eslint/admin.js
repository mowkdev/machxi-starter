import { defineConfig } from "eslint/config";
import i18next from "eslint-plugin-i18next";
import globals from "globals";
import tseslint from "typescript-eslint";

import { config as reactConfig } from "./react.js";

/**
 * The rule set every admin-shaped SPA in this repository applies — the React
 * config plus the mechanical half of ADR-0046 §8.
 *
 * It lives here rather than in `apps/admin/eslint.config.js` for the reason
 * `apiConfig` does (ADR-0002 §Lint rules): D8's customer app applies the same
 * export, and a second copy is where two apps' rules diverge. What stays in the
 * app's own config is what only that app has — its FSD element map, its
 * `shared/ui` door — because those name directories rather than decisions.
 *
 * **`no-literal-string` is the half of the sweep that does not depend on a
 * reviewer noticing.** D7 moved some two hundred strings into catalogues; this
 * is what stops the two hundred and first being written as a literal. It can
 * only be switched on after the sweep is finished, which is why it lands at
 * `D7.6` and not at `D7.2`: a rule that fires on every literal is red until the
 * app has none.
 *
 * @param {{ tsconfigRootDir: string }} options
 *   `tsconfigRootDir` is the app's own directory. The rule below is type-aware
 *   — see the comment at the point of use — so it needs a TypeScript program,
 *   and resolving it from the linted package rather than from `process.cwd()`
 *   keeps `eslint` working from anywhere. The same argument `apiConfig` takes,
 *   for the same reason.
 * @returns {import("eslint").Linter.Config[]}
 */
export const adminConfig = ({ tsconfigRootDir }) =>
  defineConfig(
    ...reactConfig,

    {
      files: ["src/**/*.{ts,tsx}"],
      plugins: { i18next },
      /*
       * Type-aware, and it is the option that makes the rule usable rather
       * than a nuisance.
       *
       * Without a program the rule sees every string literal inside JSX alike,
       * so `t("actions.apply")`, `can("read", resource)` and
       * `align ?? "start"` are reported beside a genuine sentence — and the
       * only defence is a hand-kept list of callee names, which is exactly the
       * kind of list that rots into `// eslint-disable` comments. With one, a
       * literal whose *contextual type* is a string-literal union is skipped,
       * and that is the correct rule stated properly: a `TranslationKey`, an
       * `Action` and an alignment are identifiers the compiler already
       * checks, not copy an operator reads.
       *
       * It is the same trade `apiConfig` makes for `no-floating-promises`:
       * a program for the rules that cannot be decided syntactically, and
       * nothing else type-checked.
       */
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        "i18next/no-literal-string": [
          "error",
          {
            /*
             * JSX text **and** the four attributes an operator reads.
             *
             * `jsx-text-only`, the plugin's default, would leave
             * `aria-label="Close"` untouched — and four of the six strings
             * ADR-0046 §12 had to reach into the design system for were
             * exactly that shape: copy a visual walk never notices and a
             * screen reader reads out loud. `jsx-only` adds attributes; the
             * `include` list keeps it to the ones a person hears or sees
             * rather than every `variant`, `role` and `data-*` in the tree.
             */
            mode: "jsx-only",
            "jsx-attributes": {
              include: ["alt", "aria-label", "placeholder", "title"],
            },
            /*
             * The message the rule teaches with. The plugin's default —
             * "disallow literal string" — says what is forbidden and not what
             * to do, and a lint rule that has to be explained during
             * onboarding is the outcome ADR-0002 writes rules to avoid.
             */
            message:
              "Operator-facing copy is a catalogue key (ADR-0046): add it to `shared/i18n/locales/en/<namespace>.json` and render it through `t()`",
          },
        ],
      },
    },

    {
      /*
       * Where literals are the subject rather than the symptom.
       *
       * `shared/i18n` is the catalogues, the pseudo-locale's alphabet and the
       * tables that bind an enum member to a key — every one of them a string
       * by definition. The test directories assert on the copy the catalogues
       * hold, and a suite that had to write `t("staff:title")` to say which
       * heading it expected would be asserting that i18next agrees with itself
       * (ADR-0036).
       */
      files: [
        "src/shared/i18n/**",
        "src/test/**",
        "src/**/__tests__/**",
        "src/**/__checks__/**",
      ],
      rules: { "i18next/no-literal-string": "off" },
    },

    {
      // The config files themselves are JavaScript and outside any tsconfig.
      files: ["**/*.js", "**/*.mjs"],
      extends: [tseslint.configs.disableTypeChecked],
    },

    {
      /*
       * An app's own tooling runs in Node, not in a browser.
       *
       * The React config above declares browser and service-worker globals,
       * which is right for `src/` and wrong for a script that reads the tree
       * and writes an exit code — `process` would be an undeclared global and
       * the only way past it a file-level disable comment.
       */
      files: ["scripts/**/*.mjs"],
      languageOptions: { globals: globals.node },
    },
  );
