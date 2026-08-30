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
   */
  server: {
    warmup: {
      clientFiles: ["./src/app/routes/**/*.tsx", "./src/pages/**/*.tsx"],
    },
  },
});
