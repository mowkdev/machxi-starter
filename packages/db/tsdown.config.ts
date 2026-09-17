import { defineConfig } from "tsdown";

/**
 * The migration runner as a deployable bundle (ADR-0059 §5, `D14.3`).
 *
 * Until this existed, applying a migration in production meant shipping this
 * package's TypeScript source **and** a TypeScript runtime to read it —
 * `db:migrate` is `tsx src/migrate.ts`. `dist/migrate.js` is what the API
 * image carries instead, run as the one-shot `migrate` service the API waits
 * on (`docker/prod/compose.yaml`). It is a release step, never a boot step:
 * ADR-0008's refusal to auto-migrate is untouched.
 *
 * Built the way the API's bundle is built (`apps/api/tsdown.config.ts`) with
 * one deliberate difference: **the runtime dependencies are inlined too**.
 * The API's bundle keeps them external because it is installed beside a
 * `node_modules` it owns; this file is copied to `/app/dist/migrate.js` next
 * to a tree deployed for `apps/api`, where `postgres` — a dependency of this
 * package and not of that app — is not resolvable. A one-shot process that
 * carries its own closure cannot be broken by the image's layout.
 *
 * `migrations/` is not bundled — it is committed SQL, copied beside the file
 * and found by `tooling/env.ts`'s walk for `migrations/meta/_journal.json`.
 */
export default defineConfig({
  entry: ["src/migrate.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  // tsdown defaults to a fixed `.mjs` extension on `platform: "node"` since
  // 0.13. This package is `"type": "module"`, so `.js` is already ESM to node,
  // and the name is load-bearing: `apps/api/Dockerfile` copies
  // `dist/migrate.js` and `docker/prod/compose.yaml` runs it by that name.
  fixedExtension: false,
  // Declarations for a one-shot process nothing imports would be three files
  // in the image for no reader; 0.23 turns them on by default for a package
  // that declares `exports`.
  dts: false,
  deps: {
    // Everything, including `@repo/*` (TypeScript source, ADR-0002) and the
    // third-party runtime deps. Node's own builtins stay external via
    // `platform: "node"`.
    alwaysBundle: [/./],
    // `argon2` is a native CJS addon whose `.node` binary cannot be inlined
    // (the same constraint `apps/api` records). Nothing on the migrate path
    // reaches it — `readArgon2Params` moved to `tooling/argon2.ts` for exactly
    // that reason — but naming it here keeps a future import a build error
    // rather than a container that cannot start.
    neverBundle: ["argon2"],
    // Bundling the runtime closure is this file's whole point, so the hint
    // that a `node_modules` dependency reached the bundle has nothing to warn
    // about here.
    onlyBundle: false,
  },
  outDir: "dist",
  clean: true,
});
