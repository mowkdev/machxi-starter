import boundaries from "eslint-plugin-boundaries";
import { defineConfig, globalIgnores } from "eslint/config";
import { fileURLToPath } from "node:url";

import { adminConfig } from "@repo/eslint-config/admin";

/**
 * `apps/customer` — the shared admin-shaped config plus what makes ADR-0049's
 * layering and ADR-0051's doors real in *this* app (ADR-0055 §2).
 *
 * The shared half — React's rules and ADR-0046 §8's `no-literal-string` — is
 * `@repo/eslint-config/admin`, applied verbatim: `adminConfig` was written at
 * `D7.6` with the sentence "D8's customer app applies the same export", and
 * this is that export's second consumer arriving with no diff to the package.
 *
 * What stays here is what names directories only this app has: the FSD element
 * map below, and the door list. **The doors are per-app** (ADR-0051), so this
 * file names the four this app has today — `shared/ui`, `shared/i18n`,
 * `shared/theme` and `shared/lib` — and grows with the packages the later
 * steps adopt (`api` at `D12.2`, `form` at `D12.6`).
 *
 * **The door blocks are generated from one table rather than hand-written per
 * slice.** `apps/admin`'s config states each door by writing out every *other*
 * door's pattern inside it — correct, and six copies of one list that have to
 * be edited together. Here the list is data and {@link doorRules} subtracts the
 * one group each door is the door for, so adding a package is one row. Nothing
 * about the rule changes: a door is exempt from its own group and from no
 * other, which is exactly the invariant the admin's blocks keep by repetition.
 */

/** The layers of ADR-0049, in the order the dependency rule allows them. */
const LAYERS = ["pages", "widgets", "features", "entities"];

/**
 * A slice is consumed only through its public API — an `index.ts` at the slice
 * root — so what a slice does not export does not exist to the rest of the app.
 *
 * `shared` is exempt: its slices are the app's own toolbox, directories of
 * small modules, and requiring an index per slice would be ceremony without a
 * boundary to defend.
 */
const publicApiOf = (types) => ({
  to: { element: { type: types }, file: { path: "**/index.{ts,tsx}" } },
});

const anyFileOf = (types) => ({ to: { element: { type: types } } });

/**
 * The doors: one row per package this app reaches through `shared/`.
 *
 * `slices` is which `src/shared/*` directories are the door for that package —
 * `@repo/app-services` has two here, as it has four in the admin, because one
 * package holds the theme and the route-meta readers and neither belongs in the
 * other's slice.
 */
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
    slices: ["i18n"],
    group: ["@repo/i18n", "@repo/i18n/*"],
    message:
      "Import the i18n machinery through `@/shared/i18n`, not from @repo/i18n directly (ADR-0051).",
  },
  {
    slices: ["theme", "lib"],
    group: ["@repo/app-services", "@repo/app-services/*"],
    message:
      "Import the app services through `@/shared/{theme,lib}/*`, not from @repo/app-services directly (ADR-0051).",
  },
];

const restrict = (doors) => [
  "error",
  { patterns: doors.map(({ group, message }) => ({ group, message })) },
];

/**
 * One config block per door slice, each carrying every group **except** the one
 * it is the door for.
 *
 * Turning the rule off wholesale for a door's directory would open a hole in
 * the other doors: `shared/i18n` will hold `create-app-i18n.ts`, which composes
 * package catalogues, and a blanket `off` would let it — and anything added to
 * the slice later — reach `@repo/ui/components/*` directly.
 */
const doorRules = () =>
  DOORS.flatMap(({ slices, group }) =>
    slices.map((slice) => ({
      files: [`src/shared/${slice}/**`],
      rules: {
        "no-restricted-imports": restrict(
          DOORS.filter((door) => door.group !== group),
        ),
      },
    })),
  );

/** @type {import("eslint").Linter.Config} */
export default defineConfig(
  adminConfig({
    // The app's own directory, so the type-aware half of the shared config
    // finds this package's `tsconfig.json` however `eslint` was invoked.
    tsconfigRootDir: fileURLToPath(new URL(".", import.meta.url)),
  }),

  // A build artifact whose types the app depends on (ADR-0049): regenerated by
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
       * what makes it a unit test rather than a second consumer.
       */
      "boundaries/ignore": [
        "src/app/routeTree.gen.ts",
        "src/**/__tests__/**",
        // The bundler's entry point. It belongs to no layer by construction —
        // it is the file that mounts `app` — and is listed rather than left
        // unknown so `no-unknown-files` below can be strict about everything
        // else.
        "src/main.tsx",
      ],

      /*
       * Without this the whole rule above is decoration: the plugin resolves
       * every import to the element that owns it, and an import it cannot
       * resolve is simply "unknown" and passes. `@/…` comes from the tsconfig
       * paths, and neither that nor a directory with an `index.tsx` resolves
       * without a resolver that knows TypeScript.
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
       * to `entities`/`shared` or promote it into a widget.
       */
      "boundaries/dependencies": [
        "error",
        {
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
                // accident.
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
       * Without these two, the layer rule has a hole big enough to walk
       * through: `boundaries/dependencies` says nothing about a dependency
       * whose target matches no element, so a file dropped outside the six
       * layer folders would be importable from everywhere and checked by
       * nothing.
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
       * is a real variable, stays outside it, and is declared by the task that
       * inlines it — `apps/customer/turbo.json`.
       */
      "turbo/no-undeclared-env-vars": [
        "error",
        { allowList: ["DEV", "PROD", "MODE", "SSR", "BASE_URL"] },
      ],

      "no-restricted-imports": restrict(DOORS),
    },
  },

  ...doorRules(),
);
