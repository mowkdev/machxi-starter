import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

import { config } from "./index.js";

/**
 * The API's rule set — the lint half of the ADRs (ADR-0002 §Lint rules).
 *
 * These are the rules that make an architectural decision mechanical instead of
 * a review convention: a layer violation, an ad hoc response body, an
 * unvalidated environment read or a class fails `pnpm lint` rather than
 * depending on a reviewer noticing it.
 *
 * It lives here, not in `apps/api/eslint.config.js`, because ADR-0002 collects
 * the table in one place — a second app in this repository would apply the same
 * export.
 *
 * @param {{ tsconfigRootDir: string }} options
 *   `tsconfigRootDir` is the app's own directory; the type-aware rules below
 *   need a TypeScript program, and resolving it from the linted package rather
 *   than from `process.cwd()` keeps `eslint` working from anywhere.
 * @returns {import("eslint").Linter.Config[]}
 */
export const apiConfig = ({ tsconfigRootDir }) =>
  defineConfig(
    ...config,

    {
      // Type-aware linting, for the two rules that cannot be decided
      // syntactically. Express 5 forwards rejected promises to the error
      // middleware (ADR-0003), which is only useful if the promise is actually
      // returned or awaited — `no-floating-promises` is what catches the case
      // where it is not and the request hangs or fails silently (ADR-0011).
      //
      // Only these two rules, not the whole `recommendedTypeChecked` set:
      // ADR-0002 names them, and the `no-unsafe-*` family would mostly fire on
      // supertest's `response.body`, which is `any` by design.
      files: ["**/*.ts"],
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        "@typescript-eslint/no-floating-promises": "error",
        "@typescript-eslint/no-misused-promises": "error",
      },
    },

    {
      // The config files themselves are JavaScript and outside any tsconfig.
      files: ["**/*.js", "**/*.mjs"],
      extends: [tseslint.configs.disableTypeChecked],
    },

    {
      files: ["src/**/*.ts"],
      rules: {
        // ADR-0009: functional style. No classes, no `this`, no decorators —
        // every layer is a `create<Module><Layer>(deps)` factory returning a
        // frozen object, and types come from `ReturnType`.
        //
        // ADR-0012: a controller may not write a response body itself. The
        // envelope is produced by `respond.*` and by the error middleware, both
        // of which live in `core/http` and are exempted below.
        "no-restricted-syntax": ["error", ...functionalStyle, ...noRawResponse],
      },
    },

    {
      files: ["src/core/http/**/*.ts"],
      rules: {
        // Where the envelope is written; the functional-style ban still applies.
        "no-restricted-syntax": ["error", ...functionalStyle],
      },
    },

    {
      files: ["src/**/*.ts"],
      ignores: ["src/core/config/**"],
      rules: {
        // ADR-0004: one typed, validated config object per process, built once
        // at startup. An ad hoc `process.env` read is untyped, silently
        // defaulted and invisible to `.env.example`.
        "no-restricted-properties": [
          "error",
          {
            object: "process",
            property: "env",
            message:
              "Read configuration through core/config (ADR-0004); add the variable to the zod schema and .env.example.",
          },
        ],
      },
    },

    {
      files: ["src/modules/**/*.service.ts"],
      rules: {
        // ADR-0010: services take `ctx` as their first parameter. Reaching for
        // the ambient context hides a dependency that a signature should state,
        // and forces every unit test to build a storage harness.
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/core/context", "**/core/context/*"],
                importNames: ["getContext", "tryGetContext"],
                message:
                  "Services receive `ctx` as their first argument (ADR-0010); getContext() is for infrastructure.",
              },
              ...noExpress,
              ...noSchemaTables,
            ],
          },
        ],
      },
    },

    {
      files: ["src/modules/**/*.repository.ts"],
      rules: {
        // ADR-0009: a repository knows Drizzle and the schema, never HTTP.
        "no-restricted-imports": ["error", { patterns: noExpress }],
      },
    },

    {
      files: ["src/modules/**/*.controller.ts"],
      rules: {
        // ADR-0009: SQL lives in repositories. A controller that can reach a
        // table can write a query, and the layering stops being checkable.
        "no-restricted-imports": ["error", { patterns: noSchemaTables }],
      },
    },
  );

/** @type {import("eslint").Linter.RuleEntry[]} */
const functionalStyle = [
  {
    selector: "ClassDeclaration",
    message:
      "No classes (ADR-0009): export a create* factory returning an object.",
  },
  {
    selector: "ClassExpression",
    message:
      "No classes (ADR-0009): export a create* factory returning an object.",
  },
  {
    selector: "ThisExpression",
    message:
      "No `this` (ADR-0009): closures carry dependencies, not instance state.",
  },
  {
    selector: "Decorator",
    message:
      "No decorators (ADR-0009): wiring is explicit in core/container.ts.",
  },
];

/**
 * `res.json(…)` and `res.status(…).json(…)`, in both spellings of the
 * parameter name. Two selectors because the receiver of the second form is the
 * `res.status(…)` call, not the identifier.
 */
const noRawResponse = ["json", "send", "jsonp", "sendStatus"].flatMap(
  (method) => [
    {
      selector: `CallExpression[callee.property.name='${method}'][callee.object.name=/^(res|response)$/]`,
      message:
        "Respond through respond.* (ADR-0012); only core/http writes a response body.",
    },
    {
      selector: `CallExpression[callee.property.name='${method}'][callee.object.callee.object.name=/^(res|response)$/]`,
      message:
        "Respond through respond.* (ADR-0012); only core/http writes a response body.",
    },
  ],
);

const noExpress = [
  {
    group: ["express", "express/*"],
    message:
      "This layer must not know about HTTP (ADR-0009); take plain arguments and throw AppErrors.",
  },
];

/**
 * Both spellings of a table import: the dedicated subpath, and the package
 * root, which re-exports the same tables (ADR-0002, amended 2026-08-18).
 * Restricting only the subpath would leave the rule bypassable by one import.
 */
const noSchemaTables = [
  {
    group: ["@repo/db/schema"],
    message:
      "SQL belongs in a repository (ADR-0009); services and controllers take mapped resources.",
  },
  {
    group: ["@repo/db"],
    importNames: [
      "schema",
      "sessions",
      "staff",
      "staffRoles",
      "userRoles",
      "users",
      "principalTypeEnum",
      "staffRoleEnum",
      "staffStatusEnum",
      "userRoleEnum",
      "userStatusEnum",
    ],
    message:
      "SQL belongs in a repository (ADR-0009); services and controllers take mapped resources.",
  },
];
