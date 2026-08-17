# machxi-starter

Blueprint monorepo (Turborepo + pnpm) for projects that need an API, an admin panel and a web app.

Architecture is decided in [`docs/adr/`](docs/adr/README.md); the build order for the
first deliverable is in [`docs/implementation-plan.md`](docs/implementation-plan.md).

## Requirements

- Node 22 (`.nvmrc`)
- pnpm 10 — `corepack enable`
- Docker (local Postgres)

## What's inside

### Apps

- `apps/api` — Express REST API (ADR-0003)
- `apps/admin` — Vite + React SPA, port 3001 (ADR-0022)
- `apps/web` — Next.js app, port 3002 (ADR-0022)

### Packages

- `@repo/eslint-config` — shared ESLint flat configs
- `@repo/typescript-config` — shared tsconfig bases
- `@repo/vitest-config` — shared Vitest presets (`node`, `react`)
- `@repo/logger` — structured logger (ADR-0005)
- `@repo/ui` — shared React components

Internal packages ship TypeScript source and are compiled by the consuming app's
bundler, so there is no per-package build step (ADR-0002).

## Getting started

```sh
corepack enable
pnpm install
pnpm dev
```

## Tooling

- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [ESLint](https://eslint.org/) for code linting
- [Vitest](https://vitest.dev/) for unit and integration tests
- [Prettier](https://prettier.io) for code formatting
