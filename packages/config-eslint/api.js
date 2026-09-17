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
        //
        // ADR-0072 §2: the fake identity provider is reachable from tests
        // only. The block below, which the test files match, drops this
        // selector with the response rule.
        "no-restricted-syntax": [
          "error",
          ...functionalStyle,
          ...noRawResponse,
          ...noFakeOidcProvider,
        ],
      },
    },

    {
      // Where the envelope is written, and the test fixtures that stand in for
      // a controller: a probe route in a test has no service to call and no
      // resource to envelope, and forcing `respond.*` on it would only mean
      // testing the helper with itself. The functional-style ban still applies
      // to both.
      files: ["src/core/http/**/*.ts", "src/**/__tests__/**/*.ts"],
      rules: {
        "no-restricted-syntax": ["error", ...functionalStyle],
      },
    },

    {
      // `core/http` writes response bodies, but it is not a test: the block
      // above drops the fake-provider rule for both, so it is put back here
      // for `core/http` alone (`D19.2`'s `security-reviewer`).
      files: ["src/core/http/**/*.ts"],
      ignores: ["src/**/__tests__/**/*.ts"],
      rules: {
        "no-restricted-syntax": [
          "error",
          ...functionalStyle,
          ...noFakeOidcProvider,
        ],
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
        // ADR-0009: a repository knows Drizzle and the schema, never HTTP —
        // and ADR-0058: it knows every table except the append-only one, whose
        // single insert path lives in `core/audit`.
        "no-restricted-imports": [
          "error",
          { patterns: [...noExpress, ...noAuditTable] },
        ],
      },
    },

    {
      // ADR-0058, the other half of the same rule: `core/` holds the audit
      // writer, so it is the one place outside a module repository that could
      // reach the table — and only `audit.repository.ts` may.
      files: ["src/core/**/*.ts"],
      ignores: ["src/core/audit/audit.repository.ts"],
      rules: {
        "no-restricted-imports": ["error", { patterns: noAuditTable }],
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

    {
      // ADR-0073 §10: a module's `wire*` file is its share of the composition
      // root — it calls the module's own factories and hands them what the
      // root gave it. It is not a layer, which is exactly why it needs the
      // service's two restrictions: the file that constructs every layer of a
      // module is the easiest place to smuggle a query or a handler in beside
      // them, and a root that reached a table would make the layering
      // uncheckable from the one file no layer rule covers.
      files: ["src/modules/**/wire*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          { patterns: [...noExpress, ...noSchemaTables] },
        ],
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

/**
 * The fake identity provider, by name, in both spellings a file could reach it
 * through (ADR-0072 §2; `D19.1`'s `security-reviewer`).
 *
 * The fake answers any scripted ID token, so a process that ran the sign-in
 * flow against it would sign anybody in as anybody. The composition root
 * therefore never chooses it from configuration — it takes an injected
 * provider or builds Google's — and this rule is what keeps "never" true: no
 * file under `src/` outside a test may import it, whatever a later change to
 * the container intends. Its re-export from `core/oidc/index.ts` is an export,
 * not an import, and the test harness under `test/` is outside `src/`.
 */
const noFakeOidcProvider = [
  {
    selector: "ImportSpecifier[imported.name='createFakeOidcProvider']",
    message:
      "The fake identity provider is for tests only (ADR-0072 §2): the container takes an injected provider or builds Google's.",
  },
  {
    selector: "ObjectPattern > Property[key.name='createFakeOidcProvider']",
    message:
      "The fake identity provider is for tests only (ADR-0072 §2): the container takes an injected provider or builds Google's.",
  },
  {
    selector: "MemberExpression[property.name='createFakeOidcProvider']",
    message:
      "The fake identity provider is for tests only (ADR-0072 §2): the container takes an injected provider or builds Google's.",
  },
];

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
/**
 * `audit_events`, restricted everywhere except its one writer (ADR-0058).
 *
 * Separate from {@link noSchemaTables} because it is a different rule with a
 * different shape: that list keeps SQL out of the layers that should not hold
 * any, and applies to services and controllers; this one keeps *one table* out
 * of every layer but a single file, repositories included, because
 * "append-only" is only real if no other code can call `.update()` on it.
 */
const noAuditTable = [
  {
    group: ["@repo/db", "@repo/db/schema"],
    importNames: ["auditEvents", "auditActorTypeEnum"],
    message:
      "`audit_events` is append-only (ADR-0058): core/audit's repository holds the only insert, and nothing else may reach the table.",
  },
];

/**
 * Every table `@repo/db` exports from its package root, by export name.
 *
 * Hand-maintained and therefore checked: a unit test in `packages/db` diffs
 * this list against the schema's own table exports and fails naming the
 * missing one (ADR-0061 §4). A table that escapes it is reachable from any
 * service, silently — which is the whole failure mode this rule exists to
 * prevent, arriving through the one door the rule does not cover.
 *
 * Exported for that test alone. Nothing else should read it.
 */
export const RESTRICTED_SCHEMA_TABLE_IMPORTS = [
  // The one token table behind every mail flow (ADR-0071 §1). Exactly the
  // protection `sessions` and `impersonationHandoffs` get and no more: this
  // list feeds `noSchemaTables`, which covers services and controllers, so a
  // *repository* may still import the table — that is the layering rule
  // (ADR-0009), not a single-writer rule. `core/tokens` being the only place
  // that mints and consumes is a convention this list does not enforce; the
  // `noAuditTable` shape below is what enforcing it would look like.
  // (`D18.1`'s `security-reviewer`, on a comment that claimed more than the
  // rule delivers.)
  "accountTokens",
  // `audit_events` is append-only by decision (ADR-0058), and the decision is
  // only real if no service can reach the table: the writer in `core/audit` is
  // the one insert path, and it holds no update or delete. The database
  // enforces the same thing twice over since ADR-0061 §2.
  "auditEvents",
  // A user's external identities (ADR-0072 §1) — a way into an account, so
  // a query over it belongs in a repository like every other credential
  // table's, and nowhere above one.
  "federatedIdentities",
  "impersonationHandoffs",
  // The tenant and what it owns (ADR-0067). Nothing above a repository reaches
  // a table, and these three least of all: an organization query without its
  // scope is a cross-tenant read, and the only file that can forget the scope
  // is the one file allowed to write the query.
  "organizationInvitations",
  "organizationMemberships",
  "organizations",
  "sessions",
  "staff",
  "staffRoles",
  "staffSettings",
  "userRoles",
  "userSettings",
  "users",
];

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
      ...RESTRICTED_SCHEMA_TABLE_IMPORTS,
      "auditActorTypeEnum",
      "federatedProviderEnum",
      "organizationKindEnum",
      "organizationRoleEnum",
      "principalTypeEnum",
      "staffRoleEnum",
      "staffStatusEnum",
      "tokenPurposeEnum",
      "userRoleEnum",
      "userStatusEnum",
    ],
    message:
      "SQL belongs in a repository (ADR-0009); services and controllers take mapped resources.",
  },
];
