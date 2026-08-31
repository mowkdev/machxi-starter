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
   */
  server: {
    warmup: {
      clientFiles: ["./src/app/routes/**/*.tsx", "./src/pages/**/*.tsx"],
    },
  },
});
