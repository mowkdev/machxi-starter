import { execSync } from "node:child_process";

import type { PlopTypes } from "@turbo/gen";

/**
 * `pnpm turbo gen` — the two scaffolds (ADR-0063 §3).
 *
 * **The templates are the description of a module and of a resource screen.
 * When the shape changes, the template changes in the same step.** A shape that
 * lives only in a skill document decays, because nothing runs it; a shape that
 * lives in a template is exercised the next time anyone adds a resource, and
 * `pnpm check` is what says whether it still holds.
 *
 * Two generators, matching the two halves of a feature:
 *
 * - `api-module` — the contract, the table, and the eight files of ADR-0009's
 *   module, with its unit and index tests.
 * - `resource-screen` — the admin slices of ADR-0049 over that contract: the
 *   entity, the feature, the thin page, the four record routes, both
 *   catalogues, the MSW handlers and the tests.
 *
 * **What they apply and what they print.** Everything a compiler or a test
 * would redden is applied — the contract barrel, the schema namespace, the
 * hand-maintained table enumerations of ADR-0061 §4 (three of them since
 * `D15.1`, the third only for a tenant-scoped table), the namespace list and the
 * bundled catalogue. Everything that is a *decision* is printed: the guard a
 * router mounts under, the composition-root wiring, the migration, the policy
 * row of ADR-0042 (which `policy.ts` requires be transcribed from an
 * `authorize(` call and from nothing else — a generator inventing one would be
 * the transcription lying), the sidebar entry and its icon, and the Postman
 * folder. A generator that guessed at any of those would produce a plausible
 * answer nobody had taken.
 *
 * **`organizationScoped`** (ADR-0067 §1/§5) emits the tenant column, one
 * composite index led by it per order the endpoint offers, and the required —
 * never optional — organization parameter on every repository and service
 * function. It is a prompt rather than a follow-up edit because retrofitting a
 * tenant column is the rewrite ADR-0067 exists to avoid, and because a required
 * parameter added now is free where one added later is a compile error at every
 * call site. On `resource-screen` it means almost nothing — see the prompt.
 */

/** The answers a generator's `actions` reads back to build its own output. */
interface Answers {
  readonly name: string;
  readonly plural: string;
  readonly organizationScoped: boolean;
  readonly segment?: string;
}

/**
 * The repository root. Turbo runs a generator with the destination base path at
 * the root of the monorepo, so every path below is written from there and the
 * two shell actions run there too.
 */
const root = process.cwd();

/**
 * A shell action, for the two commands a scaffold has to end with.
 *
 * `execSync` with every argument quoted, rather than `execFileSync`: on Windows
 * `pnpm` is a `.cmd` shim, which Node refuses to spawn directly since the 2024
 * argument-injection fix, so a shell is unavoidable there. The quoting is what
 * makes the same line safe on POSIX — `/bin/sh` would otherwise glob-expand the
 * prettier patterns below before prettier ever saw them.
 */
const run =
  (command: string, args: readonly string[]): PlopTypes.CustomActionFunction =>
  () => {
    const line = [command, ...args.map((arg) => `"${arg}"`)].join(" ");

    try {
      execSync(line, { cwd: root, stdio: "pipe" });
    } catch (error) {
      /*
       * `stdio: "pipe"` keeps a clean prettier run out of plop's action list,
       * and it also means a failure arrives as a bare "Command failed" with the
       * reason captured and discarded — after two dozen files have already been
       * written. So the captured streams are put back into the message: a
       * prettier parse error or a failed Vite build is the thing the user needs
       * to read, and re-running the generator to see it is not an option once
       * the `add` actions have run.
       */
      const { stderr, stdout } = error as {
        stderr?: Buffer | string | null;
        stdout?: Buffer | string | null;
      };
      const detail = [stderr, stdout]
        .map((stream) => String(stream ?? "").trim())
        .filter(Boolean)
        .join("\n");

      throw new Error(
        detail === "" ? `${line} failed.` : `${line} failed:\n\n${detail}`,
        { cause: error },
      );
    }

    return line;
  };

/**
 * Prettier over what was just written.
 *
 * The templates are then free to be readable rather than pre-formatted, which
 * is the difference between a template a person can maintain and one that is a
 * minified string with `{{` in it.
 */
const formatting = (globs: readonly string[]): PlopTypes.CustomActionFunction =>
  run("pnpm", ["exec", "prettier", "--log-level", "warn", "--write", ...globs]);

/**
 * The instructions the generator deliberately does not carry out, printed last.
 *
 * A returned string is what plop renders as an action's result, so this is a
 * "print" action in the only shape plop has one.
 */
const instructions =
  (lines: readonly string[]): PlopTypes.CustomActionFunction =>
  () =>
    `\n${lines.join("\n")}\n`;

/** One `add`, with the boilerplate every one of them repeats. */
const add = (path: string, templateFile: string): PlopTypes.ActionType => ({
  type: "add",
  path,
  templateFile: `templates/${templateFile}`,
});

/**
 * The locales `apps/admin` ships a catalogue for (ADR-0046 §2), `en` first
 * because it is the type source.
 */
const ADMIN_LOCALES = ["en", "lv"] as const;

/**
 * The plural forms a locale needs *beyond* `one` and `other`, which the seed
 * template writes unconditionally.
 *
 * `apps/admin/scripts/i18n.mjs` asks `Intl.PluralRules` which categories a
 * locale has and reports every key missing one, so a seed that copied English's
 * two forms into `lv` — which has three, `zero` among them — fails
 * `pnpm i18n:check` on the first run. Asking the same source the checker asks
 * is what keeps a generated catalogue green in a locale nobody here writes, and
 * in one a fork adds later.
 */
const extraPluralForms = (locale: string): readonly string[] =>
  new Intl.PluralRules(locale)
    .resolvedOptions()
    .pluralCategories.filter((form) => form !== "one" && form !== "other");

/**
 * The admin tests whose `lv` fixture spells every namespace out.
 *
 * A `Catalogue` is `Readonly<Record<AppNamespace, object>>`, so each of these is
 * an enumeration the compiler checks and no `NAMESPACES.map` can stand in for —
 * which is deliberate where it is written, and is why the generator fills them
 * rather than printing them.
 */
const PARTIAL_LV_FIXTURES = [
  "apps/admin/src/app/__tests__/ui-strings.test.tsx",
  "apps/admin/src/shared/form/__tests__/server-errors-locale.test.tsx",
] as const;

/** One locale's seeded catalogue, carrying that locale's plural forms. */
const seededCatalogue = (
  path: string,
  locale: string,
): PlopTypes.ActionType => ({
  type: "add",
  path,
  templateFile: "templates/resource-screen/locale.json.hbs",
  data: { extraPluralForms: extraPluralForms(locale) },
});

const namePrompt = (label: string): PlopTypes.PromptQuestion => ({
  type: "input",
  name: "name",
  message: `${label} — singular, lower case (widget, invoice, api-key)`,
  validate: (value: string) =>
    /^[a-z][a-z0-9-]*$/.test(value) || "lower case, digits and dashes only",
});

const pluralPrompt: PlopTypes.PromptQuestion = {
  type: "input",
  name: "plural",
  message: "the plural, lower case (widgets, invoices, api-keys)",
  default: (answers: Answers) => `${answers.name}s`,
  validate: (value: string) =>
    /^[a-z][a-z0-9-]*$/.test(value) || "lower case, digits and dashes only",
};

/**
 * The tenant question, asked with the answer each generator can actually act on.
 *
 * On `api-module` it is the whole of ADR-0067 §1: the column, its tenant-led
 * indexes and a required scope on every repository and service function. On
 * `resource-screen` almost nothing follows from it — a screen reads the
 * contract, and the contract already carries the field — so the only thing it
 * shapes is whether the MSW rows carry an `organizationId`. Saying so is the
 * point: a prompt that promised the screen a tenant it does not enforce would
 * teach the operator the screen is scoped when only the mock is.
 */
const organizationScopedPrompt = (
  consequence: string,
): PlopTypes.PromptQuestion => ({
  type: "confirm",
  name: "organizationScoped",
  message: `owned by an organization? (ADR-0067 §1 — ${consequence})`,
  default: false,
});

export default function generator(plop: PlopTypes.NodePlopAPI): void {
  plop.setGenerator("api-module", {
    description:
      "An API feature module (ADR-0009): its contract, its table, and the module with its tests.",
    prompts: [
      namePrompt("the aggregate"),
      pluralPrompt,
      {
        type: "list",
        name: "segment",
        message: "which route segment (ADR-0015)",
        choices: ["admin", "user", "public"],
        default: "admin",
      },
      organizationScopedPrompt(
        "the tenant column, its tenant-led indexes, a required scope on every repository and service function",
      ),
    ],
    actions: (data) => {
      const answers = data as unknown as Answers;
      const contracts = "packages/contracts/src/{{kebabCase plural}}";
      const module = "apps/api/src/modules/{{kebabCase plural}}";
      const segment = answers.segment ?? "admin";

      return [
        // The contract first: everything below imports from it (ADR-0023).
        add(`${contracts}/types.ts`, "api-module/contracts.types.ts.hbs"),
        add(`${contracts}/schemas.ts`, "api-module/contracts.schemas.ts.hbs"),
        add(`${contracts}/index.ts`, "api-module/contracts.index.ts.hbs"),
        {
          type: "modify",
          path: "packages/contracts/src/index.ts",
          pattern: /(export \* from "\.\/auth\/index\.js";\r?\n)/,
          template: '$1export * from "./{{kebabCase plural}}/index.js";\n',
        },

        // The table, and the two hand-maintained enumerations of ADR-0061 §4 —
        // applied rather than printed, because `enumerations.test.ts` reddens
        // the moment a table export escapes either list.
        add(
          "packages/db/src/schema/{{kebabCase plural}}.ts",
          "api-module/schema.ts.hbs",
        ),
        {
          type: "modify",
          path: "packages/db/src/schema/index.ts",
          pattern: /(export \{ auditEvents \} from "\.\/audit\.js";\r?\n)/,
          template:
            '$1export { {{camelCase plural}} } from "./{{kebabCase plural}}.js";\n',
        },
        /*
         * And the package's own barrel, which enumerates its tables rather than
         * re-exporting the schema namespace: `import { widgets } from "@repo/db"`
         * is what every repository writes (ADR-0006), and a table reachable only
         * through `schema/index.js` is `undefined` there at run time — a failure
         * that surfaces as a null dereference in the repository rather than as a
         * missing export.
         */
        {
          type: "modify",
          path: "packages/db/src/index.ts",
          pattern: /(export \{\r?\n  auditEvents,\r?\n)/,
          template: "$1  {{camelCase plural}},\n",
        },
        {
          type: "modify",
          path: "packages/config-eslint/api.js",
          pattern: /(export const RESTRICTED_SCHEMA_TABLE_IMPORTS = \[\r?\n)/,
          template: '$1  "{{camelCase plural}}",\n',
        },
        {
          type: "modify",
          path: "packages/db/src/testing.ts",
          pattern: /(export const TRUNCATED_TABLES = \[\r?\n)/,
          template: '$1  "{{snakeCase plural}}",\n',
        },
        /*
         * And the **third** enumeration, when the table carries the tenant
         * column (ADR-0067 §5). Conditional and not unconditional: the list is
         * "every table with an `organization_id`", and putting an unscoped
         * table in it would fail the same enumeration test from the other side.
         *
         * Applied rather than printed, like the two above it and for the same
         * reason — a test would redden without it, so it is not a decision
         * anybody is being asked to take (ADR-0063 §3). It was missing until
         * `D15.8`, which is what §Definition-of-done item 7 exists to find: the
         * list was born at `D15.1` with two of its three writers taught about
         * it, and a generated tenant-scoped module was red on `pnpm check` from
         * then until here.
         */
        ...(answers.organizationScoped
          ? [
              {
                type: "modify",
                path: "packages/db/src/testing.ts",
                pattern: /(export const TENANT_OWNED_TABLES = \[\r?\n)/,
                template: '$1  "{{snakeCase plural}}",\n',
              } satisfies PlopTypes.ActionType,
            ]
          : []),

        // The module (ADR-0009), in dependency order.
        add(
          `${module}/{{kebabCase plural}}.schemas.ts`,
          "api-module/schemas.ts.hbs",
        ),
        add(
          `${module}/{{kebabCase plural}}.mapper.ts`,
          "api-module/mapper.ts.hbs",
        ),
        add(
          `${module}/{{kebabCase plural}}.errors.ts`,
          "api-module/errors.ts.hbs",
        ),
        add(
          `${module}/{{kebabCase plural}}.repository.ts`,
          "api-module/repository.ts.hbs",
        ),
        add(
          `${module}/{{kebabCase plural}}.service.ts`,
          "api-module/service.ts.hbs",
        ),
        add(
          `${module}/{{kebabCase plural}}.controller.ts`,
          "api-module/controller.ts.hbs",
        ),
        add(
          `${module}/{{kebabCase plural}}.routes.ts`,
          "api-module/routes.ts.hbs",
        ),
        add(`${module}/wire.ts`, "api-module/wire.ts.hbs"),
        add(`${module}/index.ts`, "api-module/index.ts.hbs"),
        add(
          `${module}/__tests__/{{kebabCase plural}}.service.test.ts`,
          "api-module/service.test.ts.hbs",
        ),
        add(
          `${module}/__tests__/{{kebabCase plural}}.list-indexes.test.ts`,
          "api-module/list-indexes.test.ts.hbs",
        ),

        formatting([
          `${plop.renderString(contracts, answers)}/**`,
          `${plop.renderString(module, answers)}/**`,
          "packages/db/src/schema/**",
          "packages/db/src/index.ts",
          "packages/db/src/testing.ts",
          "packages/contracts/src/index.ts",
          "packages/config-eslint/api.js",
        ]),

        instructions([
          "Four edits are yours, because each of them is a decision (ADR-0063 §3):",
          "",
          "  1. `pnpm db:generate`, review the SQL, `pnpm db:migrate`. Migrations",
          "     come from drizzle-kit and never from a template (ADR-0006).",
          "  2. `apps/api/src/core/container.ts` — one `const x = wireX({ db: db.db })`",
          "     line in construction order, and its entries in the returned",
          "     `repositories`, `services` and `controllers` maps. The wiring itself",
          "     is generated, in the module's own `wire.ts` (ADR-0073 §10).",
          `  3. \`apps/api/src/routes/${segment}.router.ts\` — mount the router **with`,
          "     its `authorize(...)` guard**. A resource router mounted without one",
          "     is a review failure (ADR-0019 §Rules).",
          "  4. `docs/postman` — the five requests and their envelope tests",
          "     (ADR-0021), then `pnpm test:postman`.",
          "",
          "Then `pnpm check`, and `pnpm test` once the migration has run.",
        ]),
      ];
    },
  });

  plop.setGenerator("resource-screen", {
    description:
      "An admin resource screen (ADR-0049) over an existing API module: entity, feature, page, routes, catalogues, mocks, tests.",
    prompts: [
      namePrompt("the resource"),
      pluralPrompt,
      organizationScopedPrompt(
        "here, only whether the MSW rows carry one; the column and the scope are the api-module generator's",
      ),
    ],
    actions: (data) => {
      const answers = data as unknown as Answers;
      const entity = "apps/admin/src/entities/{{kebabCase name}}";
      const feature = "apps/admin/src/features/{{kebabCase name}}-manage";
      const page = "apps/admin/src/pages/{{kebabCase plural}}";
      const routes = "apps/admin/src/app/routes";

      return [
        add(
          `${entity}/{{kebabCase name}}.keys.ts`,
          "resource-screen/keys.ts.hbs",
        ),
        add(
          `${entity}/{{kebabCase name}}.api.ts`,
          "resource-screen/api.ts.hbs",
        ),
        add(
          `${entity}/{{kebabCase name}}.queries.ts`,
          "resource-screen/queries.ts.hbs",
        ),
        add(
          `${entity}/{{kebabCase name}}.config.ts`,
          "resource-screen/config.ts.hbs",
        ),
        add(`${entity}/index.ts`, "resource-screen/entity.index.ts.hbs"),
        add(
          `${entity}/__tests__/{{kebabCase name}}.config.test.ts`,
          "resource-screen/config.test.ts.hbs",
        ),

        add(`${feature}/types.ts`, "resource-screen/feature.types.ts.hbs"),
        add(
          `${feature}/create-{{kebabCase name}}-surface.tsx`,
          "resource-screen/create-surface.tsx.hbs",
        ),
        add(
          `${feature}/edit-{{kebabCase name}}-surface.tsx`,
          "resource-screen/edit-surface.tsx.hbs",
        ),
        add(
          `${feature}/{{kebabCase name}}-confirm-dialogs.tsx`,
          "resource-screen/confirm-dialogs.tsx.hbs",
        ),
        add(
          `${feature}/{{kebabCase name}}-dialogs.tsx`,
          "resource-screen/dialogs.tsx.hbs",
        ),
        add(
          `${feature}/use-{{kebabCase name}}-row-actions.ts`,
          "resource-screen/use-row-actions.ts.hbs",
        ),
        add(
          `${feature}/use-bulk-delete-{{kebabCase plural}}.ts`,
          "resource-screen/use-bulk-delete.ts.hbs",
        ),
        add(`${feature}/index.ts`, "resource-screen/feature.index.ts.hbs"),

        add(`${page}/index.tsx`, "resource-screen/page.tsx.hbs"),
        add(
          `${page}/__tests__/{{kebabCase plural}}-page.test.tsx`,
          "resource-screen/page.test.tsx.hbs",
        ),

        add(
          `${routes}/_dashboard.{{kebabCase plural}}.tsx`,
          "resource-screen/route.list.tsx.hbs",
        ),
        add(
          `${routes}/_dashboard.{{kebabCase plural}}.index.tsx`,
          "resource-screen/route.index.tsx.hbs",
        ),
        add(
          `${routes}/_dashboard.{{kebabCase plural}}.new.tsx`,
          "resource-screen/route.new.tsx.hbs",
        ),
        add(
          `${routes}/_dashboard.{{kebabCase plural}}.\${{camelCase name}}Id.tsx`,
          "resource-screen/route.record.tsx.hbs",
        ),

        add(
          "apps/admin/src/test/msw/handlers/{{kebabCase plural}}.handlers.ts",
          "resource-screen/handlers.ts.hbs",
        ),

        /*
         * Every catalogue, and the two lists that load them. `en` is the type
         * source (ADR-0046 §2), so a key it lacks is a red `check-types`; the
         * others are seeded from the same template so `pnpm i18n:check` is green
         * and a translator has the shape to work against rather than a blank
         * file — each with the plural forms *its own* locale requires, which is
         * the one thing the shared template cannot be the same for.
         */
        ...ADMIN_LOCALES.map((locale) =>
          seededCatalogue(
            `apps/admin/src/shared/i18n/locales/${locale}/{{camelCase plural}}.json`,
            locale,
          ),
        ),
        /*
         * The list's last entry carries a trailing comma, so the anchor has to
         * consume it: appending `,\n  "x"` after one produces a *sparse* array,
         * which type-checks, lints and formats — and hands `createI18n` an
         * `undefined` namespace that only shows up as a failed init.
         */
        {
          type: "modify",
          path: "apps/admin/src/shared/i18n/namespaces.ts",
          pattern: /,(\r?\n\] as const;\r?\n\r?\nexport type Namespace)/,
          template: ',\n  "{{camelCase plural}}",$1',
        },
        {
          type: "modify",
          path: "apps/admin/src/shared/i18n/resources.ts",
          pattern: /(import type \{ Namespace \} from "\.\/namespaces";\r?\n)/,
          template:
            'import en{{pascalCase plural}} from "./locales/en/{{camelCase plural}}.json";\n$1',
        },
        {
          type: "modify",
          path: "apps/admin/src/shared/i18n/resources.ts",
          pattern: /,(\r?\n\} as const;)/,
          template: ",\n  {{camelCase plural}}: en{{pascalCase plural}},$1",
        },

        /*
         * And the `CustomTypeOptions` augmentation, which is what turns the new
         * catalogue into keys: `TranslationKey` resolves over this interface, so
         * a namespace absent from it makes every `"{{camelCase plural}}:…"` in
         * the generated slice a `check-types` error suggesting the *demo*
         * fixture's key instead (ADR-0046 §2).
         */
        {
          type: "modify",
          path: "apps/admin/src/shared/i18n/types.d.ts",
          pattern: /(^import type .+\r?\n)(\r?\n)/m,
          template:
            '$1import type {{camelCase plural}} from "./locales/en/{{camelCase plural}}.json";\n$2',
        },
        {
          type: "modify",
          path: "apps/admin/src/shared/i18n/types.d.ts",
          pattern: /(\r?\n    \};\r?\n  \}\r?\n\})/,
          template:
            "\n      {{camelCase plural}}: typeof {{camelCase plural}};$1",
        },

        /*
         * The test fixtures that enumerate the namespaces by hand — each a
         * partly-translated `lv` — because `Catalogue` is
         * `Record<AppNamespace, object>` and the compiler names what a new slice
         * added. They are filled here rather than left to be noticed for the
         * reason the whole list above is applied: the generated tree has to be
         * green, and an empty object is exactly what an untranslated namespace
         * looks like.
         */
        ...PARTIAL_LV_FIXTURES.map((path): PlopTypes.ActionType => ({
          type: "modify",
          path,
          pattern: /(\r?\n      lv: \{\r?\n)/,
          template: "$1        {{camelCase plural}}: {},\n",
        })),

        formatting([
          `${plop.renderString(entity, answers)}/**`,
          `${plop.renderString(feature, answers)}/**`,
          `${plop.renderString(page, answers)}/**`,
          `${routes}/**`,
          "apps/admin/src/test/msw/handlers/**",
          "apps/admin/src/shared/i18n/**",
          ...PARTIAL_LV_FIXTURES,
        ]),

        /*
         * The route tree, regenerated by the app's own build.
         *
         * `createFileRoute("/_dashboard/x")` is typed against
         * `src/app/routeTree.gen.ts`, so a route file added without
         * regenerating it is a `check-types` failure rather than a dead link.
         * The plugin that writes it is configured once, in
         * `apps/admin/vite.config.ts`, and running the build is what uses
         * *that* configuration instead of a second copy of it here.
         */
        run("pnpm", [
          "--filter",
          "admin",
          "exec",
          "vite",
          "build",
          "--logLevel",
          "error",
        ]),

        instructions([
          "Three edits are yours, because each of them is a decision (ADR-0063 §3):",
          "",
          "  1. `apps/admin/src/shared/auth/policy.ts` — a row for this resource,",
          "     **transcribed from the `authorize(` calls that mount it** and from",
          "     nothing else (ADR-0042); then the fixture in",
          "     `shared/auth/__tests__/policy.test.ts`, and swap the page's",
          "     `capabilities` line for `useAllowedCapabilities`. The generated page",
          "     passes the config's own block ungated, and says so where it does it.",
          "  2. `apps/admin/src/widgets/app-sidebar/index.tsx` — the nav entry: its",
          "     `to`, its `NavKey`, its icon, and `nav.*` in both `common.json`s.",
          "  3. The copy in `shared/i18n/locales/{en,lv}/`, which is seeded English.",
          "",
          "Then `pnpm check`.",
        ]),
      ];
    },
  });
}
