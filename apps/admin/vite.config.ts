import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
