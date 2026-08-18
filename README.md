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
- `@repo/crypto` — argon2id hashing and token generation (ADR-0018)
- `@repo/contracts` — zod request schemas, resource types, envelope and error codes shared by the API and the frontends (ADR-0023)
- `@repo/ui` — shared React components

Internal packages ship TypeScript source and are compiled by the consuming app's
bundler, so there is no per-package build step (ADR-0002).

## Getting started

```sh
corepack enable
pnpm install
cp .env.example .env      # every variable is documented there (ADR-0004)
pnpm docker:up            # local Postgres, waits until healthy (ADR-0007)
pnpm dev
```

`docker/local/` holds the compose setup; see [`docker/README.md`](docker/README.md)
for the scripts (`docker:up` / `down` / `reset` / `logs`), the two databases
(`machxi` and `machxi_test`) and troubleshooting. Database migrations and seeds
(`pnpm db:setup`) arrive with `@repo/db` in step 6 of the implementation plan.

## Tooling

- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [ESLint](https://eslint.org/) for code linting
- [Vitest](https://vitest.dev/) for unit and integration tests
- [Prettier](https://prettier.io) for code formatting
