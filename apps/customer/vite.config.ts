import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { versionDefine } from "./app-version";

/**
 * The customer app's build (ADR-0055 §2: the admin's records applied to a
 * second app, so this file is that one with two lines changed — the port and
 * the warmup globs' tree).
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
  /* The version constant (ADR-0054 §5). See `app-version.ts`. */
  define: versionDefine,
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
   * discovers the bare import while warming, re-runs `optimizeDeps` to include
   * it, and esbuild refuses it: "No known conditions for ./ClientRequest". The
   * optimize run then fails as a whole, so *every* optimized dependency answers
   * `504 Outdated Optimize Dep` and the app renders a blank page — a total
   * failure caused by a module the browser was never meant to load.
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
