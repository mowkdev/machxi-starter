import { defineConfig } from "tsdown";

/**
 * Build (ADR-0003): one ESM file, `dist/main.js`, started with `node`.
 *
 * ESM rather than the starter's CJS: the dependency graph is ESM-only in
 * places (`zod` 4, pino transports), and a CJS bundle would have to interop
 * with all of it for no benefit — nothing consumes this output but `node`.
 */
export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  // tsdown defaults to a fixed `.mjs` extension on `platform: "node"` since
  // 0.13. This package is `"type": "module"`, so `.js` is already ESM to node,
  // and the name is load-bearing: the Dockerfile's `CMD`, the compose file's
  // `migrate` command, `package.json`'s `start` and the deploy guide all say
  // `dist/main.js`. Opting out keeps one filename instead of five edits.
  fixedExtension: false,
  deps: {
    // Internal packages ship TypeScript source (ADR-0002), so the consuming
    // app's bundler is what compiles them. tsdown treats everything in
    // `dependencies` as external by default, which would leave `dist/main.js`
    // importing `@repo/contracts` at runtime — and node would then try to load
    // a `.ts` file and fail on the first `import`.
    alwaysBundle: [/^@repo\//],
    // `argon2` is a native CJS addon (ADR-0002): its `.node` binary cannot be
    // inlined, so it stays a runtime dependency resolved from node_modules.
    // It is also why `argon2` is a direct dependency of this app and not only
    // of `@repo/crypto`: once that package is inlined, the import has to
    // resolve from here.
    //
    // `pino` is a direct dependency for the same class of reason. Bundling
    // `@repo/logger` while `pino-http` stays external would put two copies of
    // pino in one process, and pino-http reaches into the logger through
    // pino's private symbols — which silently do not match across copies, so
    // the first completed request crashes the server. Declaring `pino` there
    // makes it external too, and both halves share one instance.
    neverBundle: ["argon2"],
    // `postgres` reaches the bundle through the inlined `@repo/db` and is not
    // a dependency of this app, which is the arrangement ADR-0002 describes
    // and not an accident; naming it here silences 0.23's new hint without
    // turning the check off.
    onlyBundle: ["postgres"],
  },
  outDir: "dist",
  clean: true,
});
