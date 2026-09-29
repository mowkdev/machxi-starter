import boundaries from "eslint-plugin-boundaries";
import { defineConfig, globalIgnores } from "eslint/config";
import { fileURLToPath } from "node:url";

import { adminConfig } from "@repo/eslint-config/admin";
import {
  doorBypass,
  doorExemption,
  doorRules,
  restrictImports,
} from "@repo/eslint-config/doors";

/**
 * `apps/admin` — the shared admin config plus the thing that makes ADR-0032
 * real.
 *
 * The shared half is React's rules and ADR-0046 §8's `no-literal-string`, both
 * of which D8's customer app applies verbatim. What stays here is what names
 * directories only this app has: the FSD element map below, and the
 * `shared/ui` door.
 *
 * Feature-Sliced Design without an import linter decays into folders with
 * aspirational names: any ES import resolves, so structure cannot enforce the
 * dependency rule and lint has to. An upward import, a cross-slice import
 * within a layer, or a reach past a slice's public API fails `pnpm lint`, which
 * fails the gate — the rule is taught by the error message rather than by the
 * onboarding doc.
 */

/** The layers of ADR-0049, in the order the dependency rule allows them. */
const LAYERS = ["pages", "widgets", "features", "entities"];

/**
 * A slice is consumed only through its public API — an `index.ts` at the slice
 * root — so what a slice does not export does not exist to the rest of the app.
 * Expressing it inside the `to` selector means one rule enforces both halves:
 * which layers may be imported, and through which file.
 *
 * `shared` is exempt: its slices are the app's own toolbox, directories of
 * small modules (`api/client.ts`, `lib/format.ts`), and requiring an index per
 * slice would be ceremony without a boundary to defend.
 */
const publicApiOf = (types) => ({
  to: { element: { type: types }, file: { path: "**/index.{ts,tsx}" } },
});

const anyFileOf = (types) => ({ to: { element: { type: types } } });

/**
 * The doors: one row per platform package this app reaches through `shared/`
 * (ADR-0051's door rule, as data since `D14.8` — ADR-0062 §1).
 *
 * Until this step the blocks below were written out by hand: nine of them,
 * each restating every *other* door's patterns inside itself, in 745 lines.
 * Correct, and nine copies of one list that had to be edited together.
 * `apps/customer` generated them from a table from its first day; the helper
 * that does it now lives in `@repo/eslint-config/doors`, so both apps — and
 * any third — consume one implementation and declare only their table.
 *
 * `slices` is which `src/shared/*` directories are the door for that package.
 * One package can have several (`@repo/app-services` has four here, because
 * the theme, the grid density, `can()` and the route readers belong in four
 * slices), and one slice can be the door for several packages (`shared/ui`
 * fronts `@repo/ui` and the rendering half of `@repo/app-kit`) — which is why
 * `doorRules` groups its blocks by slice rather than by row.
 */
/**
 * The seventh door, named so {@link harnessRule} below can point at it
 * without counting rows (`D14.8`, ADR-0062 §1).
 */
const APP_KIT_DOOR = {
    /*
     * `D14.8`, ADR-0062 §1 — the seventh package, and the first whose door is
     * three slices of three different kinds: the rendering surfaces come
     * through `shared/ui`, the app i18n factory and its provider through
     * `shared/i18n`, and the query client through `shared/api`.
     *
     * The suite reaches `@repo/app-kit/testing` directly, and {@link doorBypass}
     * below is what allows it: the group matches by prefix, so the harness
     * entry cannot be carved out of the pattern here.
     */
    // `error-reporting` since `D22.1` (ADR-0077 §1): the reporter's factory
    // and the context's shape moved into the kit, and the slice that binds
    // them to this app's DSN and adapter is their door.
    slices: ["ui", "i18n", "api", "error-reporting"],
    group: ["@repo/app-kit", "@repo/app-kit/*"],
    message:
      "Import the shared composition through `@/shared/{ui,i18n,api,error-reporting}/*`, not from @repo/app-kit directly (ADR-0062).",
  };

const DOORS = [
  {
    slices: ["ui"],
    group: [
      "@repo/ui/components/*",
      // The compositions path of ADR-0047 §What-code — the shell, the record
      // surfaces and the banner. Design-system surface like the primitives, so
      // it comes through the same door.
      "@repo/ui/compositions/*",
      "@repo/ui/hooks/*",
      // `lib/*` too: `cn` is re-exported through the door like everything
      // else, and a rule with a gap teaches the gap.
      "@repo/ui/lib/*",
      // The `UiStrings` seam of ADR-0046 §12 is design-system surface like the
      // rest, and `app` is the one layer that must not reach past `shared`.
      "@repo/ui/ui-strings",
    ],
    message:
      "Import design-system components through `@/shared/ui`, not from @repo/ui directly (ADR-0047).",
  },
  {
    // `D9.1`. `shared/api` is a set of named re-export files over the client;
    // every layer above it imports `@/shared/api/*` exactly as it did before
    // the extraction, and this pattern is what keeps the package path from
    // leaking into a feature and quietly making the door optional.
    slices: ["api"],
    group: ["@repo/api-client", "@repo/api-client/*"],
    message:
      "Import the API client through `@/shared/api/*`, not from @repo/api-client directly (ADR-0051).",
  },
  {
    // `D9.2`. The app owns its dictionary — namespaces, catalogues, the
    // `CustomTypeOptions` merge — and reaches the factory, the locale
    // negotiation and the pseudo lens through `@/shared/i18n`.
    slices: ["i18n"],
    group: ["@repo/i18n", "@repo/i18n/*"],
    message:
      "Import the i18n machinery through `@/shared/i18n`, not from @repo/i18n directly (ADR-0051).",
  },
  {
    // `D9.3`. `ResourceConfig` and its readers, through `@/shared/resource/*`.
    slices: ["resource"],
    group: ["@repo/resource", "@repo/resource/*"],
    message:
      "Import the resource vocabulary through `@/shared/resource/*`, not from @repo/resource directly (ADR-0051).",
  },
  {
    // `D9.4`. The table, its preferences and the record-navigation carrier.
    slices: ["grid"],
    group: ["@repo/grid", "@repo/grid/*"],
    message:
      "Import the data grid through `@/shared/grid/*`, not from @repo/grid directly (ADR-0051).",
  },
  {
    // `D9.5`. The adapters, the frame, the three record shells and the
    // server-error landing.
    slices: ["form"],
    group: ["@repo/form", "@repo/form/*"],
    message:
      "Import the form machinery through `@/shared/form/*`, not from @repo/form directly (ADR-0051).",
  },
  {
    // `D9.6`, and `density` since `D11.6`. Four doors over one package,
    // because the theme, the grid density, `can()` and the route readers
    // belong in four slices — not because the package is four packages.
    slices: ["auth", "theme", "lib", "density"],
    group: ["@repo/app-services", "@repo/app-services/*"],
    message:
      "Import the app services through `@/shared/{auth,theme,density,lib}/*`, not from @repo/app-services directly (ADR-0051).",
  },
  APP_KIT_DOOR,
];

/**
 * The one file that is exempt, and it is a file rather than a slice.
 *
 * `app-i18n.ts` is where this app composes the namespaces its rendering
 * packages ship (ADR-0046 §13), so it is the one place that must reach a
 * package's catalogues directly — routing them through `@/shared/form/*` would
 * make that door export translation bundles. It is also where the zod
 * installer's two seams come from, for the same reason.
 *
 * A **file**, not the slice: `index.ts`, `keys.ts`, `namespaces.ts`,
 * `resources.ts` and this slice's checks need no such reach, and an exemption
 * that covered them would be a hole rather than a permission.
 */
const packageCatalogueRule = doorExemption({
  doors: DOORS,
  files: ["src/shared/i18n/app-i18n.ts"],
  opens: ["i18n", "form", "grid"],
});

/**
 * The one door the suite opens for itself (`D14.8`, ADR-0062 §1).
 *
 * Every test file imports the MSW server from `@repo/app-kit/testing`, which
 * is a second entry point holding the harness and nothing an app renders. The
 * pattern matches by prefix and a negation does not undo one, so **the whole
 * `@repo/app-kit` door is what opens here, not just the subpath** — a test may
 * import the kit directly. That is the latitude `boundaries/ignore` already
 * gives these same files, and it opens exactly one door: every other stays
 * shut, and a slice's own tests keep their own open too.
 */
const harnessRules = doorBypass({
  doors: DOORS,
  files: ["src/test/**", "src/**/__tests__/**"],
  opens: [APP_KIT_DOOR],
});

/** @type {import("eslint").Linter.Config} */
export default defineConfig(
  adminConfig({
    // The app's own directory, so the type-aware half of the shared config
    // finds this package's `tsconfig.json` however `eslint` was invoked.
    tsconfigRootDir: fileURLToPath(new URL(".", import.meta.url)),
  }),

  // A build artifact whose types the app depends on (ADR-0032): regenerated by
  // `dev` and `build`, never hand-edited, and resolved by regenerating rather
  // than by merging.
  globalIgnores(["src/app/routeTree.gen.ts"]),

  {
    settings: {
      "boundaries/elements": [
        { type: "app", pattern: "src/app" },
        { type: "pages", pattern: "src/pages/*", capture: ["slice"] },
        { type: "widgets", pattern: "src/widgets/*", capture: ["slice"] },
        { type: "features", pattern: "src/features/*", capture: ["slice"] },
        { type: "entities", pattern: "src/entities/*", capture: ["slice"] },
        { type: "shared", pattern: "src/shared/*", capture: ["slice"] },
        // The ADR-0036 harness. Not an FSD layer: a render helper has to reach
        // the router, and a handler has to reach the entity it answers for.
        { type: "test", pattern: "src/test" },
      ],
      "boundaries/include": ["src/**/*.ts", "src/**/*.tsx"],
      /*
       * The generated route tree, and colocated tests.
       *
       * ADR-0036 puts component tests beside the thing they test, and a test
       * is allowed to reach into internals its neighbours may not — that is
       * what makes it a unit test rather than a second consumer. Exempting
       * `__tests__` keeps the layer rule about production structure, which is
       * what ADR-0032 wrote it for.
       */
      "boundaries/ignore": [
        "src/app/routeTree.gen.ts",
        "src/**/__tests__/**",
        // The bundler's entry point. It belongs to no layer by construction —
        // it is the file that mounts `app` — and is listed rather than left
        // unknown so `no-unknown-files` below can be strict about everything
        // else.
        "src/main.tsx",
        "src/vite-env.d.ts",
      ],

      /*
       * Without this the whole rule above is decoration: the plugin resolves
       * every import to the element that owns it, and an import it cannot
       * resolve is simply "unknown" and passes. `@/…` comes from the tsconfig
       * paths and a slice import is a directory with an `index.ts`
       * — neither resolves without a resolver that knows TypeScript.
       *
       * Verified by probe rather than assumed: with the elements matching but
       * no resolver, an upward import from `shared` to `widgets` linted clean.
       */
      "import/resolver": {
        typescript: { project: "./tsconfig.json" },
      },
    },

    plugins: { boundaries },

    rules: {
      /*
       * app → pages → widgets → features → entities → shared, and nothing
       * upward or sideways.
       *
       * `default: "disallow"` is what makes this a whitelist, and it carries
       * more than the arrows: because same-layer imports are not allowed
       * anywhere except `shared`, two slices of the same layer cannot import
       * each other either. Two features that need the same thing must demote it
       * to `entities`/`shared` or promote it into a widget — the refactor
       * pressure by which the layers stay honest.
       */
      "boundaries/dependencies": [
        "error",
        {
          // The plugin's default message already names both element types,
          // which is the half that teaches; a custom one would only restate it.
          default: "disallow",
          policies: [
            {
              from: [{ element: { type: "app" } }],
              allow: [publicApiOf(LAYERS), anyFileOf(["shared", "app"])],
            },
            {
              from: [{ element: { type: "pages" } }],
              allow: [
                publicApiOf(["widgets", "features", "entities"]),
                anyFileOf("shared"),
              ],
            },
            {
              from: [{ element: { type: "widgets" } }],
              allow: [
                publicApiOf(["features", "entities"]),
                anyFileOf("shared"),
                // A widget composing a sibling widget is the shell/sidebar
                // split, which ADR-0049 records as a decision rather than an
                // accident. Note what it permits and the app declines: since
                // `D8.5` `dashboard-layout` *could* import `AccountMenu`
                // through `app-sidebar`'s public API, and does not — the
                // `_dashboard` route file hands it down, because a frame that
                // reaches for the account menu is a frame that knows a
                // principal exists (ADR-0049 §The-shell-adapter).
                publicApiOf("widgets"),
              ],
            },
            {
              from: [{ element: { type: "features" } }],
              allow: [publicApiOf("entities"), anyFileOf("shared")],
            },
            {
              from: [{ element: { type: "entities" } }],
              allow: [anyFileOf("shared")],
            },
            {
              from: [{ element: { type: "shared" } }],
              allow: [anyFileOf("shared")],
            },
            {
              from: [{ element: { type: "test" } }],
              allow: [publicApiOf(LAYERS), anyFileOf(["shared", "app"])],
            },
          ],
        },
      ],

      /*
       * `shared/ui` is "the one door components come through" (ADR-0032). One
       * re-export module is what makes a design-system change — a renamed
       * primitive, a wrapper with app defaults — a single edit rather than a
       * grep across every page.
       */
      /*
       * Without these two, the layer rule has a hole big enough to walk
       * through: `boundaries/dependencies` says nothing about a dependency
       * whose target matches no element, so a file dropped outside the six
       * layer folders — `src/components/x.tsx`, `src/utils.ts` — would be
       * importable from everywhere and checked by nothing. That is exactly the
       * "folders with aspirational names" outcome ADR-0032 wrote lint to
       * prevent, so an unclassified file is an error rather than an exemption.
       */
      "boundaries/no-unknown-files": "error",
      "boundaries/no-unknown-dependencies": "error",

      /*
       * Vite's own compile-time flags are not environment variables: they are
       * constants the bundler substitutes, so there is nothing for Turbo to
       * hash and declaring them in `turbo.json` would describe an input that
       * does not exist (ADR-0026 asks a task to declare what it *reads*).
       *
       * The allow-list is exactly Vite's built-ins. Anything `VITE_`-prefixed
       * is a real variable, stays outside it, and must be declared by the task
       * that inlines it — which is `D3.4`'s job for `VITE_API_URL`.
       */
      "turbo/no-undeclared-env-vars": [
        "error",
        { allowList: ["DEV", "PROD", "MODE", "SSR", "BASE_URL"] },
      ],

      "no-restricted-imports": restrictImports(DOORS),
    },
  },

  ...doorRules(DOORS),
  // After the slice blocks, so it is the one that wins for the file it names.
  packageCatalogueRule,
  // Last, so they win for the test files they name whatever slice those sit
  // in — and the per-slice blocks among them come after the blanket one, so a
  // slice's tests keep the door that slice is the door for.
  ...harnessRules,
);
