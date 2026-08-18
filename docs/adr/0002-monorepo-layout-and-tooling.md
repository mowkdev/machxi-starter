# ADR-0002: Monorepo layout and tooling

- Status: accepted
- Date: 2026-08-17

## Context

The repository was generated from the Turborepo `kitchen-sink` example. It ships four apps (`api`, `admin`, `storefront`, `blog`) and five packages (`config-eslint`, `config-typescript`, `jest-presets`, `logger`, `ui`) with several inconsistencies: `admin` is on React 18 / Vite 5 while `storefront` is on React 19 / Next 16, `pnpm` is pinned to 8.15.6, `engines.node` is `>=18`, the API uses Express 4 with `morgan`, `body-parser` and a `console.log` logger.

The target is a blueprint with exactly three apps (`api`, `admin`, `web`), shared packages that hold cross-app contracts and infrastructure, and a `docker/` directory for local and future environments.

## Decision

### Workspace layout

```
.
├── apps/
│   ├── api/            # Express 5 REST API (ADR-0003)
│   ├── admin/          # Vite + React SPA (ADR-0022)
│   └── web/            # Next.js app, renamed from storefront (ADR-0022)
├── packages/
│   ├── config-eslint/       # shared ESLint flat configs (kept)
│   ├── config-typescript/   # shared tsconfig bases (kept, tightened)
│   ├── config-vitest/       # replaces jest-presets (ADR-0021)
│   ├── logger/              # pino-based logger (ADR-0005)
│   ├── db/                  # Drizzle schema, client, migrations, seeds (ADR-0006, ADR-0008)
│   ├── crypto/              # password hashing (argon2id), token hashing, random tokens — shared by api and db seeds (ADR-0018)
│   ├── contracts/           # API contracts shared with clients: zod schemas, envelope & error types, enums (ADR-0023)
│   └── ui/                  # shared React UI (kept)
├── docker/
│   └── local/          # docker compose for local dev (ADR-0007)
├── docs/
│   ├── adr/
│   └── postman/        # collection + environment for manual API testing (ADR-0021)
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

Removed: `apps/blog` (Remix) and `packages/jest-presets`.

Package naming: all internal packages are scoped `@repo/*` (`@repo/db`, `@repo/contracts`, `@repo/logger`, …). Apps depend on packages with `workspace:*`.

### Toolchain versions

- Node **22 LTS** (`engines.node: ">=22"`, `.nvmrc` at root).
- pnpm **10.x** via `packageManager` field; `corepack enable` is the documented setup step.
- TypeScript 5.9, ESLint 9 flat config, Prettier 3.
- Turborepo 2 with `turbo.json` tasks: `build`, `dev`, `lint`, `check-types`, `test`, plus `db:generate`, `db:migrate`, `db:seed` (non-cached, see ADR-0008).

### TypeScript baseline

`@repo/typescript-config/base.json` is tightened with:

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "verbatimModuleSyntax": true,
  "module": "ESNext",             // base default; node.json overrides to NodeNext
  "moduleResolution": "Bundler",
  "target": "ES2022",
  "lib": ["ES2023"]
}
```

`base.json` defaults to `Bundler` resolution so browser apps (`vite.json`, `nextjs.json`, `react-library.json`) inherit it directly. Node-side packages/apps extend `node.json`, which overrides `module`/`moduleResolution` to `NodeNext`.

### Shared conventions

- Every **code-bearing** package/app exposes the same script names (`dev`, `build`, `lint`, `check-types`, `test`) so Turbo tasks apply uniformly. Config-only packages (`config-typescript`, which ships JSON, and `config-eslint`) declare only the scripts that have something to do; Turbo skips the rest rather than running no-op stubs. **Source-published packages are the same case** (amended 2026-08-18): `@repo/logger`, `@repo/crypto` and `@repo/contracts` have no build step by the rule below, so they declare `lint`, `check-types` and `test` only — adding no-op `build`/`dev` stubs would buy nothing.
- Internal packages (`@repo/db`, `@repo/crypto`, `@repo/logger`, `@repo/contracts`) are published as TypeScript source (`"exports": { ".": "./src/index.ts" }`) and compiled by the consuming app's bundler (`tsdown` for the API, Vite/Next for the frontends). This removes the per-package build step and the `dependsOn: ["^build"]` latency in dev. Packages that need a compiled artifact (`ui`, if published) may keep a build.
- `.env` files are never committed; `.env.example` files are (ADR-0004).
- Dependency direction between packages is one-way: `contracts` → nothing internal; `crypto` → nothing internal; `db` → `crypto`, `contracts`; `logger` → nothing internal; apps → any package. Enforced with `eslint-plugin-boundaries` or a `depcruise` check in CI.
- **Node-only packages must not reach a browser bundle** (amended 2026-08-18). `@repo/logger` (pino) and `@repo/crypto` (argon2) are Node-only; `apps/web` and `apps/admin` may depend on neither, and the boundaries/`depcruise` check enforces it. This is why `apps/web` dropped `@repo/logger` in step 1.
- **Native dependencies are allowlisted explicitly** (amended 2026-08-18). pnpm 10 blocks install scripts by default, so a package with a native addon must be listed in the root `pnpm.onlyBuiltDependencies` or it installs broken. Current entries: `esbuild`, `argon2`. `argon2` resolves from the prebuilt binaries in its own `prebuilds/` directory, so a clean clone needs no local C++ toolchain. It is also CJS-only (`main: argon2.cjs`) and native, so the API bundler (`tsdown`) must mark it **external** rather than attempt to inline it.
- **A package the bundler inlines brings its own external dependencies with it** (amended 2026-08-18, step 7). Because internal packages ship source, `tsdown` must be told to inline them (`noExternal: [/^@repo\//]`) — it treats everything in `dependencies` as external by default, and `dist/main.js` would otherwise `import '@repo/contracts'` at runtime and hand node a `.ts` file. Two consequences, both discovered by running the built bundle rather than by review:
  - **An inlined package's own external imports must resolve from the app.** `argon2` and `pino` are dependencies of `@repo/crypto` and `@repo/logger`; once those are inlined, the import sits in `apps/api/dist/main.js` and pnpm's non-flat `node_modules` will not resolve it from there. Both are therefore direct dependencies of `apps/api` as well.
  - **A shared library must not end up bundled on one side and external on the other.** `pino-http` is a direct dependency of the API and stays external, and it reaches into a pino logger through pino's *private* symbols. With `pino` inlined via `@repo/logger` there were two pino instances, the symbols did not match, and the first completed request crashed the process — with no type error and no failing test, because in dev and under vitest both sides resolve to the same file. Declaring `pino` in the app is what makes it external on both sides. The general rule: any package that two bundled-and-external halves must *share an instance of* has to be a direct dependency of the app.

### Lint rules that enforce ADRs

Collected here so they are implemented once in `@repo/eslint-config`:

| Rule | Enforces |
|---|---|
| `no-restricted-syntax`: `res.json` / `res.send` outside `apps/api/src/core/http/**` | ADR-0012 envelope helpers only |
| `no-restricted-imports`: `getContext` inside `modules/**/*.service.ts` | ADR-0010 explicit `ctx` param in services |
| `no-restricted-imports`: `express` inside `*.service.ts`, `*.repository.ts` | ADR-0009 layer boundaries |
| `no-restricted-imports`: `@repo/db` schema/tables inside `*.service.ts`, `*.controller.ts` — both the `@repo/db/schema` specifier **and** `importNames` on `@repo/db`, which re-exports the tables from its root | ADR-0009 SQL only in repositories |
| `no-restricted-properties`: `process.env` outside `apps/api/src/core/config/**` and `packages/db/src/tooling/env.ts` (the integration harness `apps/api/test/setup/env.ts` sits outside `src/**` and outside the rule — ADR-0004) | ADR-0004 |
| `no-restricted-syntax`: `ClassDeclaration`, `ClassExpression`, `ThisExpression` in `apps/api/src/**` | ADR-0009 functional style |
| `@typescript-eslint/no-floating-promises`, `no-misused-promises` | ADR-0011 async handlers |
| `no-console` (use logger) | ADR-0005 |

**Implemented 2026-08-18 (step 7)** as `@repo/eslint-config/api`, an `apiConfig({ tsconfigRootDir })` function that `apps/api/eslint.config.js` applies; a second Express app would apply the same export rather than a copy. Two notes on the implementation:

- The last two rows need type information, so the config turns on `parserOptions.projectService`. It takes **only those two rules** from `tseslint.configs.recommendedTypeChecked` and not the set: the `no-unsafe-*` family fires mostly on supertest's `response.body`, which is `any` by design, and silencing it file by file would cost more than it catches.
- `no-restricted-syntax` cannot be split across two config objects for the same file, because a later config replaces the rule rather than extending it. The class/`this`/decorator selectors and the `res.json` selectors are therefore assembled together for `src/**`, and `src/core/http/**` and `src/**/__tests__/**` re-declare the list without the response selectors — a probe route in a test has no service to call and no resource to envelope, so forcing `respond.*` on it would only mean testing the helper with itself.
- The base config also gained `@typescript-eslint/no-unused-vars` with `argsIgnorePattern: "^_"`, so ESLint and the shared tsconfig's `noUnusedParameters` stop disagreeing about the same line.

## Consequences

- Fewer moving parts (no Remix, no Jest/ts-jest, no per-package bundling); `turbo dev` starts faster.
- `web` rename is a one-time cost; the ADRs already refer to `web`.
- Aligning `admin` to React 19 / Vite 7 is required for `@repo/ui` to have a single React peer version.
- Downstream projects get an opinionated but consistent baseline.

## Alternatives considered

- Keep the kitchen-sink apps as-is: leaves dead code (`blog`) and version drift in the blueprint.
- Nx instead of Turborepo: more features than needed; Turborepo is already in place and sufficient.
- Compile every package (`bunchee`/`tsup`) as before: adds latency and dist bookkeeping for packages with a single consumer.
