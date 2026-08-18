# machxi-starter

Blueprint monorepo (Turborepo + pnpm) for projects that need an API, an admin panel and a web app.

The API is complete and runnable: Express 5 on Node 22, PostgreSQL via Drizzle,
two authenticated populations (staff and users) with roles, a unified response
envelope, and a Postman collection that proves the whole surface works.

Architecture is decided in [`docs/adr/`](docs/adr/README.md) — read the relevant
ADR before changing anything it covers. The build order that produced the current
state is in [`docs/implementation-plan.md`](docs/implementation-plan.md).

## Requirements

- Node 22 (`.nvmrc`)
- pnpm 10 — `corepack enable`
- Docker (local Postgres)

## Quick start

```sh
corepack enable
pnpm install
cp .env.example .env         # every variable is documented there (ADR-0004)
pnpm docker:up               # local Postgres, waits until healthy (ADR-0007)
pnpm db:setup                # migrations + super admin seed (ADR-0008)
pnpm db:seed -- --dev        # local fixture accounts (optional, but the smoke test needs them)
pnpm dev --filter api        # http://localhost:4000
```

Then, in a second terminal:

```sh
curl http://localhost:4000/health/ready
pnpm test:postman            # 66 requests, 202 assertions — did it actually work?
```

`pnpm test:postman` runs the Postman collection headless with newman against
`localhost`, signing in as the super admin from your `.env`. It is the executable
half of the ADR-0021 acceptance checklist: if it is green, the clone works.

`pnpm dev` with no filter starts the API, `admin` (port 3001) and `web` (port 3002) together.

### Signing in

`pnpm db:setup` seeds one super admin from `SEED_SUPER_ADMIN_EMAIL` /
`SEED_SUPER_ADMIN_PASSWORD` in your `.env`. It never rewrites an existing
account's password, so changing those values later does not reset a live account.
v1 has no staff password-change endpoint either — create a second staff account
with `POST /admin/staff` and disable the first.

`pnpm db:seed -- --dev` adds fixtures, all with the password `DevPassword!123`:

| Account                 | Population | Use it to see                                 |
| ----------------------- | ---------- | --------------------------------------------- |
| `manager@machxi.local`  | staff      | a role that may read users but not write them |
| `editor@machxi.local`   | staff      | authenticated but unprivileged — `403`        |
| `customer@machxi.local` | user       | the `/api/v1/user` segment                    |
| `pending@machxi.local`  | user       | a not-yet-activated account                   |
| `disabled@machxi.local` | user       | login refused by status                       |

```sh
curl -X POST http://localhost:4000/api/v1/admin/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"manager@machxi.local","password":"DevPassword!123"}'
```

## The API

Port 4000 by default. Every response with a body carries the ADR-0012 envelope
(`{ success, data | error, meta }`), and every response echoes `X-Request-Id`.
Logout, `sessions/revoke` and `change-password` answer `204` with nothing in it.

| Route                                          | What                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /health/live`, `/health/ready`, `/health` | liveness, and readiness including a database probe (ADR-0016)                                                      |
| `/api/v1/public/*`                             | unauthenticated — registration, behind `FEATURE_USER_REGISTRATION`                                                 |
| `/api/v1/user/*`                               | `profile`, and `auth/*` — `login` and `refresh` are mounted above the guard, the rest need a user access token     |
| `/api/v1/admin/*`                              | `staff` and `users`, and `auth/*` on the same rule — a staff access token for everything but `login` and `refresh` |

Authentication is a JWT access token (15 minutes by default) plus an opaque
rotating refresh token stored hashed in `sessions` (ADR-0018); `authorize()`
guards the admin resources by role and `super_admin` bypasses those checks
(ADR-0019). The full endpoint list is in
[`docs/implementation-plan.md`](docs/implementation-plan.md), and every endpoint
has a Postman request — most carry a description of why the API answers the way
it does, and the ones that turn on a decision name the ADR.

## Commands

```sh
pnpm dev --filter api        # API in watch mode
pnpm build                   # all apps; the API bundles to a single dist/main.js
pnpm lint && pnpm check-types
pnpm test                    # every unit suite, plus the API's integration suite — needs Docker
pnpm test:unit               # no database required
pnpm test:int                # the API's supertest suite and @repo/db's, against DATABASE_URL_TEST
pnpm test:postman            # newman smoke run against a running API
pnpm format
```

Database and infrastructure:

```sh
pnpm docker:up | docker:down | docker:reset | docker:logs
pnpm db:generate             # schema change → migration SQL (never `push`)
pnpm db:migrate              # apply; the API never migrates on boot
pnpm db:seed [-- --dev]      # idempotent seeders
pnpm db:setup                # migrate + seed
pnpm db:reset                # drop, migrate, seed — refuses NODE_ENV=production
pnpm db:studio
pnpm db:sessions:prune       # delete expired sessions (nothing schedules this yet)
```

## What's inside

### Apps

- `apps/api` — Express REST API (ADR-0003). `src/core` holds config, context,
  errors, the envelope and the middleware; `src/modules/<feature>` holds
  route → controller → service → repository; `src/core/container.ts` is the
  composition root.
- `apps/admin` — Vite + React SPA, port 3001 (ADR-0022)
- `apps/web` — Next.js app, port 3002 (ADR-0022)

The two frontends are configured but not built out — that is the next
deliverable, not this one.

### Packages

- `@repo/contracts` — zod request schemas, resource types, envelope and error codes shared by the API and the frontends (ADR-0023)
- `@repo/db` — Postgres schema, client, migrations and seeds (ADR-0006, ADR-0008)
- `@repo/crypto` — argon2id hashing and token generation (ADR-0018)
- `@repo/logger` — structured logger (ADR-0005)
- `@repo/ui` — shared React components
- `@repo/eslint-config` — shared ESLint flat configs, including the rules that enforce the ADRs
- `@repo/typescript-config` — shared tsconfig bases
- `@repo/vitest-config` — shared Vitest presets (`node`, `react`)

Internal packages ship TypeScript source and are compiled by the consuming app's
bundler, so there is no per-package build step (ADR-0002).

### Everything else

- `docker/local/` — the compose setup; see [`docker/README.md`](docker/README.md)
  for the scripts, the two databases (`machxi` and `machxi_test`) and troubleshooting.
- `docs/` — ADRs, the implementation plan, and the Postman collection.
- `scripts/` — repo-level tooling outside the workspaces, so **not** covered by
  `turbo run lint` or `check-types` (ADR-0002). Today: `postman.mjs`.
- `.claude/` — Claude Code setup: subagents and slash-command skills that encode
  the ADR checklists. See [`.claude/README.md`](.claude/README.md).

## Conventions worth knowing before the first commit

Full detail is in the ADRs; these are the ones that bite.

- **Functional style, no OOP** (ADR-0009): no `class`, no `this`, no decorators.
  Every layer is `create<Module><Layer>(deps)` returning an `as const` object.
- **Controllers respond through `respond.ok / created / list / noContent`**
  (ADR-0012); `res.json` outside `apps/api/src/core/http` is a lint error.
- **One error type** (ADR-0013): throw the `AppError` factories, check with
  `isAppError(e)` and `e.code`, never `instanceof`.
- **`process.env` is read in four places only** (ADR-0004): `core/config`,
  `packages/db/src/tooling/env.ts`, `scripts/postman.mjs` and the `apps/api/test/`
  harness. `drizzle.config.ts` reads none — it calls `readDatabaseUrl()`.
  A new variable is a three-place change: zod schema, `.env.example`, deployment
  secret store.
- **Migrations are generated and committed**, never pushed (ADR-0008).
- **New endpoints need integration tests and a Postman request** (ADR-0021).

## Tooling

- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [ESLint](https://eslint.org/) for code linting
- [Vitest](https://vitest.dev/) for unit and integration tests
- [Prettier](https://prettier.io) for code formatting
</content>
