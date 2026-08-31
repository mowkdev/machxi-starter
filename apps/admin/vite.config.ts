import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { versionDefine } from "./app-version";

export default defineConfig({
  plugins: [
    /*
     * Before `react()`, which the plugin requires: it rewrites route modules
     * for `autoCodeSplitting`, and the React plugin has to see the result.
     *
     * `routesDirectory` sits under `app/` on purpose (ADR-0032): route files
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
  /*
   * The sidebar footer's version (ADR-0054 §5, `D11.3`). See `app-version.ts`
   * for why it is a tracked file rather than an env var or a git SHA, and why
   * `vitest.config.ts` installs the same object.
   */
  define: versionDefine,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  /*
   * Dev only, and one of the two halves of ADR-0052 §Felt navigation.
   *
   * `autoCodeSplitting` above makes every route its own lazy chunk, and in
   * `pnpm dev` a chunk is transformed **on first demand** — so the first click
   * on Staff pays for transforming the page, its slice and everything they
   * pull in, while the router holds the old screen. Warmup asks Vite to
   * transform these modules as the server starts instead, into the same
   * module graph the browser will ask for.
   *
   * It changes nothing about production: `vite build` transforms everything
   * anyway, which is why the profile that sized this work ran against a
   * preview of the build rather than against this server.
   *
   * Both trees, not just `routes`: a route file's whole job is to import its
   * page, so warming the routes without the pages would warm the cheap half.
   *
   * **The exclusion is not tidiness — without it the dev server serves nothing
   * at all.** `./src/pages/**\/*.tsx` also matches
   * `src/pages/*\/__tests__/*.test.tsx`, so warmup transformed the page tests
   * too; those reach `@/test/msw/server`, which imports `msw/node`, which
   * imports `@mswjs/interceptors/ClientRequest` — an export whose `browser`
   * condition is `null` **on purpose**. Vite discovers the bare import while
   * warming, re-runs `optimizeDeps` to include it, and esbuild refuses it: "No
   * known conditions for ./ClientRequest". The optimize run then fails as a
   * whole, so *every* optimized dependency answers `504 Outdated Optimize Dep`
   * and the app renders a blank page — a total failure caused by a module the
   * browser was never meant to load.
   *
   * It is invisible to the gate: `pnpm build` has no warmup, and `pnpm test`
   * resolves `msw/node` under Node conditions where it is perfectly valid.
   * Only `pnpm dev` breaks. Met first in `apps/customer`, which had inherited
   * these globs and failed identically; fixed there at `D12.10`.
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
