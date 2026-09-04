# machxi-starter

Blueprint monorepo (Turborepo + pnpm) for projects that need an API, an admin
panel and a customer app.

All three are complete and runnable: an Express 5 API on Node 22 with PostgreSQL
via Drizzle, two authenticated populations (staff and users) with roles, a
unified response envelope and a Postman collection that proves the whole surface
works; `apps/admin` and `apps/customer`, two Vite + React SPAs built from the
same platform packages, localized, themed, and able to run an impersonated
session end to end.

Architecture is decided in [`docs/adr/`](docs/adr/README.md) — read the relevant
ADR before changing anything it covers; the index opens with a topic →
record-in-force table, and [`docs/rules/`](docs/rules/) holds the generated
digest of what is in force per area, which is what a session loads. Work is
staged into numbered deliverables (ADR-0025); the ledger is
[`docs/plan/README.md`](docs/plan/README.md), which says which deliverable is in
progress, links the build order of each, and is the one place that states which
records may still be amended in place.

**This repository is meant to be cloned into a project and merged from
afterwards.** [`docs/forking.md`](docs/forking.md) is the recipe,
[`docs/upstreaming.md`](docs/upstreaming.md) is how a generic feature comes back,
and [`docs/CHANGELOG.md`](docs/CHANGELOG.md) plus the `starter-D<n>` tags say
which starter a fork is on.

## Requirements

- Node 22 (`.nvmrc`)
- pnpm 10 — `corepack enable`
- Docker (local Postgres)

## Quick start

```sh
corepack enable
pnpm install
cp .env.example .env         # every variable is documented there (ADR-0004)
cp apps/admin/.env.example apps/admin/.env   # each browser app reads its own (ADR-0033)
cp apps/customer/.env.example apps/customer/.env
pnpm docker:up               # local Postgres + Mailpit, waits until both are
                             # healthy (ADR-0007, ADR-0066); first start also
                             # creates the machxi_app and machxi_owner roles
                             # (ADR-0061); a data volume from before that needs
                             # `pnpm docker:reset`
pnpm db:setup                # migrations + super admin seed (ADR-0008)
pnpm db:seed -- --dev        # local fixture accounts (optional, but the smoke test needs them)
pnpm dev --filter api        # http://localhost:4000
```

Then, in a second terminal:

```sh
curl http://localhost:4000/health/ready
pnpm test:postman            # 122 requests, 374 assertions — did it actually work?
```

`pnpm test:postman` runs the Postman collection headless with newman against
`localhost`, signing in as the super admin from your `.env`. It is the executable
half of the ADR-0021 acceptance checklist: if it is green, the clone works.

`pnpm dev` with no filter starts the API, `admin` (port 3001) and `customer`
(port 3002) together.

### Signing in

`pnpm db:setup` seeds one super admin from `SEED_SUPER_ADMIN_EMAIL` /
`SEED_SUPER_ADMIN_PASSWORD` in your `.env`. It never rewrites an existing
account's password, so changing those values later does not reset a live account.
A staff member changes their own password with
`POST /api/v1/admin/profile/change-password` (ADR-0027), which the admin panel's
Profile screen drives; an administrator resets somebody else's with
`POST /api/v1/admin/staff/:id/password`, re-presenting their own.

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

| Route                                          | What                                                                                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health/live`, `/health/ready`, `/health` | liveness, and readiness including a database probe (ADR-0016)                                                                                            |
| `/api/v1/public/*`                             | unauthenticated — registration, behind `FEATURE_USER_REGISTRATION`                                                                                       |
| `/api/v1/user/*`                               | `profile`, `settings`, and `auth/*` — `login` and `refresh` are mounted above the guard, the rest need a user access token                               |
| `/api/v1/admin/*`                              | `staff`, `users`, `profile`, `settings` and impersonation, and `auth/*` on the same rule — a staff access token for everything but `login` and `refresh` |

Authentication is a JWT access token (15 minutes by default) plus an opaque
rotating refresh token stored hashed in `sessions` (ADR-0018); `authorize()`
guards the admin resources by role and `super_admin` bypasses those checks
(ADR-0019). The full endpoint list is in
[`docs/plan/0001-api-foundation.md`](docs/plan/0001-api-foundation.md), and every endpoint
has a Postman request — most carry a description of why the API answers the way
it does, and the ones that turn on a decision name the ADR.

## Commands

```sh
pnpm dev --filter api        # the API alone, in watch mode
pnpm build                   # all apps; the API bundles to a single dist/main.js
pnpm check                   # the fast inner loop: lint + check-types + test:unit + i18n:check, cached
pnpm test:unit               # unit suites alone, no database required
pnpm test:int                # the API's supertest suite and @repo/db's, against DATABASE_URL_TEST
pnpm test:e2e                # Playwright over the dev stack — beside the gate, never in it
pnpm test:postman            # newman smoke run against a running API
pnpm format
```

Scaffolding (ADR-0063 §3) — each prints the edits it deliberately leaves to you,
because each of those is a decision rather than a shape:

```sh
pnpm turbo gen api-module       # a feature module: contract, table, the eight files, its tests
pnpm turbo gen resource-screen  # its admin screen: entity, feature, page, routes, catalogues, mocks, tests
```

**The gate — five links, and every change ends green on all five:**

```sh
pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check
```

`test` includes the API's integration tier, so it needs Docker up; `size` builds
each SPA and weighs the gzipped output against its own `size-budget.json`; and
`format:check` is prettier over the tree. `lint`, `check-types` and `size` are
turbo tasks and cached, so they cost nothing when nothing changed; `test` is
uncached by design because it depends on a live database (ADR-0026), and
`format:check` runs prettier directly.

Database and infrastructure:

```sh
pnpm docker:up | docker:down | docker:reset | docker:logs
pnpm db:generate             # schema change → migration SQL (never `push`)
pnpm db:migrate              # apply; the API never migrates on boot
pnpm db:seed [-- --dev]      # idempotent seeders
pnpm db:setup                # migrate + seed
pnpm db:reset                # drop, migrate, seed — refuses NODE_ENV=production
pnpm db:studio
pnpm db:sessions:prune       # delete expired sessions and spent handoffs (nothing schedules this yet)
```

Everything above except `db:sessions:prune` connects as **`machxi_owner`**
(`DATABASE_URL_OWNER`), because all of it is DDL or runs beside DDL; the API,
the prune job and the integration suite connect as **`machxi_app`**
(`DATABASE_URL`), which holds table privileges and nothing else — no schema
changes, and no `UPDATE` or `DELETE` on `audit_events`, which the database
refuses through both a revoked grant and a trigger (ADR-0061). The owner
variables are required where they are read, with no fallback: a fallback is how
a deployment ends up migrating as its application role and never finding out.

## What's inside

### Apps

- `apps/api` — Express REST API (ADR-0003). `src/core` holds config, context,
  errors, the envelope and the middleware; `src/modules/<feature>` holds
  route → controller → service → repository; `src/core/container.ts` is the
  composition root.
- `apps/admin` — Vite + React SPA, port 3001 (ADR-0022), the staff-facing panel
  over the admin segment. Feature-Sliced layers with a lint-enforced downward-only
  import direction (ADR-0049): `src/{app,pages,widgets,features,entities,shared}`.
  A resource is an entity slice that declares it, a feature slice that writes it
  and a thin page that arranges them (ADR-0035).
- `apps/customer` — Vite + React SPA, port 3002 (ADR-0055), the customer-facing
  app over the user segment. The same records as `apps/admin`, applied through
  its **own** `shared/` doors, its own dictionary and its own bundle budget: it
  is the second consumer the platform packages were extracted for, and anything
  it cannot build from them without changing them is recorded as a finding in
  `docs/plan/0012-customer-app.md`.

The marketing site is the one app that is not here yet: it is Next.js, marketing
only (ADR-0055 narrowed ADR-0022's roster), and the last deliverable in the ledger
scaffolds it fresh rather than growing the placeholder that used to sit at
`apps/web`.

### Packages

Shared by the API and the frontends:

- `@repo/contracts` — zod request schemas, resource types, envelope and error codes (ADR-0023)
- `@repo/db` — Postgres schema, client, migrations and seeds (ADR-0006, ADR-0008)
- `@repo/crypto` — argon2id hashing and token generation (ADR-0018)
- `@repo/logger` — structured logger, Node-only (ADR-0005)

The frontend packages both SPAs are built from and reach only through their own
`shared/` doors — the design system, the **six platform packages** ADR-0051
extracted the behavioural machinery into, and the **seventh** ADR-0062 added for
the composition around it. Each app keeps its dictionary, its policy data, its
config, its route tree and its size budget:

- `@repo/ui` — the shadcn/ui design system and the shell and record compositions, owned as source (ADR-0047, ADR-0048)
- `@repo/api-client` — client, session, CSRF, the URL⇄query codec, bulk fan-out (ADR-0033, ADR-0043)
- `@repo/i18n` — the `createI18n` factory (ADR-0046)
- `@repo/resource` — `ResourceConfig` and its readers (ADR-0035)
- `@repo/grid` — the v2 data grid (ADR-0038, ADR-0052)
- `@repo/form` — the field vocabulary, the three record shells, the zod locale installer
- `@repo/app-services` — theme, `can()` (ADR-0042) and route meta
- `@repo/app-kit` — the composition both SPAs share: the provider stack, the auth and account layouts, the app loader, the top-level error boundary, the router defaults, the app i18n factory, and the test harness behind `@repo/app-kit/testing` (ADR-0062)

Configuration:

- `@repo/eslint-config` — shared ESLint flat configs, including the rules that enforce the ADRs
- `@repo/typescript-config` — shared tsconfig bases
- `@repo/vitest-config` — shared Vitest presets (`node`, `react`)

Internal packages ship TypeScript source and are compiled by the consuming app's
bundler, so there is no per-package build step (ADR-0002).

### Everything else

- `.github/workflows/` — CI (ADR-0059): `gate.yml` runs the five links above on
  every push and pull request against a Postgres service; `e2e.yml` runs the
  browser tier nightly and on demand, never on push.
- `docker/local/` — the compose setup; see [`docker/README.md`](docker/README.md)
  for the scripts, the two databases (`machxi` and `machxi_test`) and troubleshooting.
  Since `D14.6` it also runs **Mailpit**: the API's `MAIL_TRANSPORT` defaults to
  `log` and delivers nothing, and switching it to `smtp` puts the message in an
  inbox at <http://localhost:8025> (ADR-0066 §1).
- `docker/prod/` — the reference deployment (ADR-0059 §6): `migrate` (one-shot,
  under a `pg_advisory_lock`), `api`, `admin` and `customer`, with Postgres and
  Redis external. The images are `apps/*/Dockerfile`, and
  [`docs/deploy.md`](docs/deploy.md) walks it on Coolify.
- `docs/` — ADRs, the implementation plan, the deployment guide, and the Postman
  collection.
- `scripts/` — repo-level tooling outside the workspaces, so **not** covered by
  `turbo run lint` or `check-types` (ADR-0002). Today: `postman.mjs`.
- `turbo/generators/` — the two scaffolds behind `pnpm turbo gen` (ADR-0063 §3).
  **The templates are the description of a module and of a resource screen**:
  when the shape changes, the template changes in the same step, because a shape
  that lives only in a document decays and one that lives in a template is
  exercised the next time anyone adds a resource.
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
- **Load your area's digest first** ([`docs/rules/`](docs/rules/)) — it is
  generated from the records and regenerated at ship, never hand-edited, and it
  names the record behind every line so you know what to open next.

## Tooling

- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [ESLint](https://eslint.org/) for code linting
- [Vitest](https://vitest.dev/) for unit and integration tests
- [Prettier](https://prettier.io) for code formatting
</content>
