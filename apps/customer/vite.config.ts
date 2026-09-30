import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { versionDefine } from "./app-version";

/**
 * The vendor groups this app actually has (ADR-0062 §4, `D14.9`).
 *
 * Three, not the admin's four: this app draws no grid, so `@tanstack/table-*`
 * is not in its dependency tree and a fourth group would name packages that
 * are never resolved — a ceiling in `size-budget.json` measuring nothing.
 *
 * Without a `manualChunks`, `autoCodeSplitting` gives every *route* its own
 * chunk and leaves everything a route imports in the entry — so React, the
 * router, the query client and the table core were 76% of all JavaScript, paid
 * before anything renders and re-downloaded whole on every deploy of the app's
 * own code. Splitting them out moves bytes rather than removing them (the `js`
 * total barely changes), and what it buys is the two things a total cannot
 * see: a smaller first paint, and three chunks whose content-hash only changes
 * when the dependency does.
 *
 * **Grouped, not one chunk per package.** `react` and `react-dom` initialise
 * in a fixed order and `@tanstack/react-router` is meaningless without
 * `router-core`, `history` and the store it reads; splitting a group across
 * chunks buys nothing and risks an initialisation order the bundler has to
 * guess.
 *
 * The names are the chunk names, so `dist/assets/vendor/react-<hash>.js` is
 * what the per-chunk ceilings in `size-budget.json` are written against — see
 * `chunkFileNames` below for why that directory exists.
 */
const VENDOR_GROUPS: Readonly<Record<string, readonly string[]>> = {
  react: ["react", "react-dom", "scheduler"],
  router: [
    "@tanstack/react-router",
    "@tanstack/router-core",
    "@tanstack/history",
    "@tanstack/react-store",
    "@tanstack/store",
  ],
  query: ["@tanstack/react-query", "@tanstack/query-core"],
};

/**
 * The npm package a module id belongs to, or `undefined` for our own source.
 *
 * The **last** `node_modules` segment, because pnpm's store nests them:
 * `node_modules/.pnpm/react-dom@19.2.0_react@19.2.0/node_modules/react-dom/…`
 * has two, and only the last one names the package. A `id.includes("react")`
 * test would put `react-i18next`, `react-hook-form` and `@types/react` in the
 * React chunk, which is how a vendor split quietly becomes a second entry.
 */
const packageOf = (id: string): string | undefined => {
  const parts = id.split(/[\\/]node_modules[\\/]/);

  if (parts.length < 2) return undefined;

  const segments = parts[parts.length - 1]?.split(/[\\/]/) ?? [];
  const [first, second] = segments;

  if (first === undefined) return undefined;

  return first.startsWith("@") && second !== undefined
    ? `${first}/${second}`
    : first;
};

/** The vendor group a module belongs to, or `undefined` for any other. */
const vendorGroupOf = (id: string): string | undefined => {
  const pkg = packageOf(id);

  if (pkg === undefined) return undefined;

  for (const [chunk, packages] of Object.entries(VENDOR_GROUPS)) {
    if (packages.includes(pkg)) return chunk;
  }

  return undefined;
};

/**
 * The customer app's build (ADR-0055 §2: the admin's records applied to a
 * second app, so this file is that one with the port, the warmup globs' tree
 * and — since `D14.9` — one vendor group's worth of difference, this app
 * having no grid to bring `@tanstack/table-*` with it).
 */
export default defineConfig({
  plugins: [
    /*
     * Before `react()`, which the plugin requires: it rewrites route modules
     * for `autoCodeSplitting`, and the React plugin has to see the result.
     *
     * `routesDirectory` sits under `app/` on purpose (ADR-0049): route files
     * are wiring — a path, a guard, a lazy page import — the SPA's equivalent
     * of `apps/api/src/routes/`, not a seventh FSD layer.
     */
    tanstackRouter({
      target: "react",
      routesDirectory: "src/app/routes",
      generatedRouteTree: "src/app/routeTree.gen.ts",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  /* The build's label, and no commit (ADR-0081 §2). See `app-version.ts`. */
  define: versionDefine(process.env),
  build: {
    /*
     * **Emitted, and not referenced from the bundle** (ADR-0062 §4). A minified
     * production stack trace is unreadable without a map, and `"hidden"` is the
     * setting that gives one to whoever holds the build — the error reporter of
     * ADR-0066 §3 — without appending a `sourceMappingURL` comment that invites
     * every visitor's devtools to fetch it.
     */
    sourcemap: "hidden",
    /*
     * Rolldown's options, because Vite 8 bundles with Rolldown (`D21.3`), and
     * one `codeSplitting` group per vendor group in place of Rollup's
     * `manualChunks` — which Rolldown keeps only as a deprecated translation
     * into groups.
     *
     * **One group each, ranked in `VENDOR_GROUPS` order.** A group also
     * captures what its packages import (`includeDependenciesRecursively`,
     * on by default, which Rolldown keeps on to avoid chunks that import each
     * other in a cycle); that is how Rollup's `manualChunks` behaved too, so
     * `scheduler` joins React and `use-sync-external-store` joins the router,
     * exactly the packages each chunk held under Vite 7. Every group imports React, and the ranking is what
     * keeps it in the React chunk: a higher priority takes a module first.
     * A single group whose `name` function returned the chunk — the literal
     * translation — let the groups race, and `react` itself landed in the
     * query chunk.
     */
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: Object.keys(VENDOR_GROUPS).map((chunk, index, all) => ({
            name: chunk,
            test: (id: string) => vendorGroupOf(id) === chunk,
            priority: all.length - index,
          })),
        },
        /*
         * Vendor chunks go in their own directory, and that is what makes the
         * per-chunk ceilings in `size-budget.json` checkable. A hashed file
         * name is `<name>-<hash>.js` and Vite's hash alphabet includes `-`, so
         * a `query-*.js` glob over `assets/` matches the vendor chunk *and*
         * this app's own `query-error-<hash>.js` — a check that measures two
         * files, or the wrong one, depending on the day's hash. A directory is
         * a boundary a glob cannot get wrong.
         *
         * A vendor chunk is recognised by what it holds, not by its name
         * alone: Rolldown names a shared chunk after a module in it, so in
         * the admin app `@repo/ui`'s `table.tsx` became a second `table`
         * chunk under Vite 8 — and a name test sent it to `vendor/`, where
         * the size link would have found two files for one ceiling. This app
         * has the same rule so a `router.ts` or `query.ts` of its own can
         * never do the same.
         */
        chunkFileNames: (chunk) =>
          chunk.moduleIds.some((id) => vendorGroupOf(id) === chunk.name)
            ? "assets/vendor/[name]-[hash].js"
            : "assets/[name]-[hash].js",
      },
    },
  },

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  /*
   * Dev only, and ADR-0052 §Felt navigation's half that costs nothing to
   * inherit: `autoCodeSplitting` makes every route its own lazy chunk, and in
   * `pnpm dev` a chunk is transformed on first demand — so the first click pays
   * for transforming the page, its slice and everything they pull in while the
   * router holds the old screen. Warmup asks Vite to transform these modules as
   * the server starts instead. It changes nothing about production.
   *
   * **The exclusion is not tidiness — without it the dev server serves nothing
   * at all** (`D12.10`, found by the first step to open this app in a browser).
   * `./src/pages/**\/*.tsx` matches `src/pages/*\/__tests__/*.test.tsx`, so
   * warmup transformed the page tests too; those reach `@/test/msw/server`,
   * which imports `msw/node`, which imports `@mswjs/interceptors/ClientRequest`
   * — an export whose `browser` condition is `null` **on purpose**. Vite
   * discovers the bare import while warming and re-runs its dependency
   * optimiser to include it, and under Vite 7 esbuild refused it: "No known
   * conditions for ./ClientRequest". The optimize run then failed as a whole,
   * so *every* optimized dependency answered `504 Outdated Optimize Dep` and
   * the app rendered a blank page — a total failure caused by a module the
   * browser was never meant to load. Since Vite 8 (`D21.3`) the optimiser is
   * Rolldown, and the exclusion stands whichever tool is asked: a module whose
   * export turns the browser away has no place in the graph the browser is
   * served.
   *
   * It is invisible to the gate: `pnpm build` has no warmup, and `pnpm test`
   * resolves `msw/node` under Node conditions where it is perfectly valid. Only
   * `pnpm dev` breaks, which is why nine steps of this app were built without
   * anyone meeting it. **`apps/admin/vite.config.ts` has the same two globs and
   * the same three page tests, and fails identically at `HEAD`** — that repair
   * is not this deliverable's to make (§Definition-of-done item 2), and it is
   * named in this step's plan entry so it is not lost.
   */
  server: {
    warmup: {
      clientFiles: [
        "./src/app/routes/**/*.tsx",
        "./src/pages/**/*.tsx",
        /*
         * Negation, rather than narrowing the glob to `*\/index.tsx`: warmup is
         * an optimisation over whatever the pages layer contains, and a pattern
         * that only matched today's file names would quietly stop warming a
         * page that grew a second module. `tinyglobby` — which Vite hands these
         * to — honours `!` in the pattern list.
         */
        "!./src/**/__tests__/**",
      ],
    },
  },
});
