# Architecture Decision Records

This directory holds the Architecture Decision Records (ADRs) for the `machxi-starter` blueprint repository.

The repository is a Turborepo/pnpm monorepo intended as a bootstrap for projects that need an API, an admin panel, a web app and (later) a mobile app. ADRs capture the _why_ behind the structure so that every project bootstrapped from this blueprint inherits the same conventions and can diverge deliberately rather than accidentally.

## Conventions

- One decision per file, numbered sequentially: `NNNN-short-kebab-title.md`.
- Format follows [ADR-0001](0001-record-architecture-decisions.md) (MADR-lite: Context, Decision, Consequences, Alternatives).
- Status is one of `proposed`, `accepted`, `deprecated`, `superseded by ADR-XXXX`. "Implemented" is not a status — it is the _Implemented_ column below, which names the [implementation-plan](../implementation-plan.md) step that built the decision and where the code lives.
- ADRs are immutable once accepted **and implemented**. Until the first deliverable ships, accepted ADRs may still be amended in place (the code does not exist yet, so there is nothing to supersede); after that, change is expressed by a superseding ADR.

  **The first deliverable shipped on 2026-08-18, so that window is closed.** Every ADR below now has code standing on it (ADR-0022 only in part — the two frontend apps exist and are configured, but building them was never in scope). The amendments dated _2026-08-18 (step N)_ inside the accepted ADRs were made under the pre-deliverable exception and are the last of their kind: from here, a decision changes by writing a new ADR that supersedes the old one.

- Code snippets in ADRs are illustrative of shape and naming; the implementation is the source of truth for details.

## Index

_Implemented_ names the build-order step from [`docs/implementation-plan.md`](../implementation-plan.md) and the code that answers to the ADR. Where an ADR was implemented across several steps, all of them are listed — the decision was made once, but the surface it governs grew.

### Foundation

| #                                              | Title                                             | Status   | Implemented                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [0001](0001-record-architecture-decisions.md)  | Record architecture decisions                     | accepted | in force — this directory                                                                                                     |
| [0002](0002-monorepo-layout-and-tooling.md)    | Monorepo layout and tooling                       | accepted | step 1 — workspace layout, shared configs; the bundling rules came from step 7 and the root `scripts/` carve-out from step 10 |
| [0003](0003-api-runtime-express-typescript.md) | API runtime: Express 5 on Node 22, TypeScript ESM | accepted | step 7 — `apps/api` (`main.ts` startup sequence, `app.ts`, `server.ts` drain)                                                 |
| [0004](0004-configuration-and-environment.md)  | Configuration and environment validation          | accepted | step 7 — `apps/api/src/core/config` (`.env.example` itself dates from step 5)                                                 |
| [0005](0005-logging.md)                        | Structured logging with pino                      | accepted | step 2 — `@repo/logger`; step 7 — `pino-http` + the context-bound child logger                                                |

### Data

| #                                               | Title                                                      | Status   | Implemented                                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| [0006](0006-database-postgres-drizzle.md)       | PostgreSQL with Drizzle ORM in a shared `@repo/db` package | accepted | step 6 — `packages/db` (`src/schema`, `createDb`)                                                                 |
| [0007](0007-local-development-docker.md)        | Local development infrastructure with Docker Compose       | accepted | step 5 — `docker/local` and the compose setup the step-1 `docker:*` scripts drive                                 |
| [0008](0008-database-migrations-and-seeding.md) | Database migrations, setup and seeding                     | accepted | step 6 — committed migrations and idempotent seeders behind the `db:*` scripts (step 8 added `db:sessions:prune`) |

### API architecture

| #                                             | Title                                                                     | Status   | Implemented                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [0009](0009-api-modular-layering.md)          | Modular API: route → controller → service → repository (functional style) | accepted | steps 7–9 — `apps/api/src/modules/{health,auth,staff,users}`, `core/container.ts`                                              |
| [0010](0010-request-context.md)               | Request context object and propagation                                    | accepted | step 7 — `core/context` (ALS + `req.ctx`); step 8 re-binds the logger to the principal                                         |
| [0011](0011-middleware-pipeline.md)           | Middleware pipeline: logging, validation, auth, errors                    | accepted | step 7 — logging, validate, no-store, 404, error handler; step 8 — `authenticate`, `authorize`, rate limits                    |
| [0012](0012-response-envelope.md)             | Unified response envelope                                                 | accepted | step 7 — `core/http` (`respond.*`, `sendErrorEnvelope`)                                                                        |
| [0013](0013-error-model.md)                   | Error model and HTTP status mapping                                       | accepted | step 7 — `core/errors` (branded `AppError` + factories)                                                                        |
| [0014](0014-pagination-filtering-sorting.md)  | Pagination, filtering and sorting conventions                             | accepted | step 4 — `listQuerySchema` in `@repo/contracts`; step 7 — `applyListQuery`; step 9 — live on `/admin/staff` and `/admin/users` |
| [0015](0015-route-segments-and-versioning.md) | Route segments (`public` / `user` / `admin`) and API versioning           | accepted | step 7 — `apps/api/src/routes`                                                                                                 |
| [0016](0016-health-checks.md)                 | Health check endpoints                                                    | accepted | step 7 — `modules/health`                                                                                                      |

### Identity and access

| #                                                    | Title                                                                        | Status   | Implemented                                                                                                                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [0017](0017-identity-model-populations-and-roles.md) | Identity model: two populations (staff, users) with roles                    | accepted | step 6 — the tables and enums; steps 8–9 — the `PrincipalAdapter` and the last-super-admin invariant                                                               |
| [0018](0018-authentication-sessions-and-tokens.md)   | Custom authentication: DB sessions, JWT access token, rotating refresh token | accepted | step 3 — `@repo/crypto`; step 8 — `modules/auth` (`jose` HS256, rotating refresh, reuse detection)                                                                 |
| [0019](0019-authorization-guards.md)                 | Authorization guards (population + role)                                     | accepted | step 8 — `core/middleware/authorize.ts`, `core/auth/policies.ts`; step 9 — mounted, with the route-by-route guard matrix test                                      |
| [0020](0020-security-baseline.md)                    | API security baseline                                                        | accepted | steps 7–9 — helmet/CORS/body limits, the three rate limiters, the argon2 concurrency cap, `no-store` on every router; §Residual risks lists what v1 does not cover |

### Quality

| #                                        | Title                                                     | Status   | Implemented                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [0021](0021-testing-strategy.md)         | Testing strategy (Vitest, supertest, Postman)             | accepted | step 1 — `@repo/vitest-config`; every step since — the suites; step 10 — `docs/postman` + `pnpm test:postman`                          |
| [0022](0022-frontend-apps.md)            | Frontend apps: `web` (Next.js) and `admin` (Vite + React) | accepted | step 1 only — the rename, the React 19 / Vite 7 alignment and the port split. Building the apps is the next deliverable, not this one. |
| [0023](0023-shared-contracts-package.md) | Shared contracts package (`@repo/contracts`)              | accepted | step 4 — `packages/contracts` (enums, envelope, error codes, request schemas, resource types)                                          |

### Planned (not yet written)

These will get their own ADRs when the corresponding features are implemented:

- Internationalization (message catalogs, `Accept-Language`, localized validation errors) — groundwork is already in ADR-0013 (machine-readable error codes).
- Browser token transport (httpOnly cookies for `web`/`admin`, CSRF) — see ADR-0018 §Consequences.
- Fine-grained permissions (permission table / policies) — see ADR-0017.
- **Secret management and key rotation** — a `kid` scheme for `JWT_ACCESS_SECRET` when moving to asymmetric signing, and an argon2 **pepper** (`argon2`'s `secret` option). Both need the same key-id/overlap machinery, and rotating a pepper forces rehash-on-next-login, so they are one decision — see ADR-0018 §Consequences.
- **Scheduling the session prune.** `pnpm db:sessions:prune` exists (ADR-0008, step 8) and expired rows accumulate until something runs it. What is undecided is _what_ runs it — cron, the platform's scheduler, or an in-process timer — which is the same decision as background jobs below.
- **OpenAPI generation** from `@repo/contracts`, and the contract-conformance test tier ADR-0021 leaves as "later". Until then the Postman collection is the API's documentation.
- **Shared rate-limit state.** The ADR-0020 limiters use an in-memory store, which counts per process; more than one API instance multiplies every limit by the instance count. A shared store is a deployment decision and belongs with the CI/deployment ADR.
- Background jobs, email delivery, file storage.
- Mobile app.
- CI pipeline and deployment (Dockerfiles for `api`, `web`, `admin`).

## First deliverable — delivered 2026-08-18

A running, testable API against a local Docker Postgres, with database setup, a seeded super admin, both authentication flows, the staff/users admin resources and the user profile — verifiable end-to-end via Postman and covered by automated tests.

- **Endpoint surface and build order**: [`docs/implementation-plan.md`](../implementation-plan.md), steps 1–11, all closed.
- **Acceptance checklist**: ADR-0021 §Acceptance checklist, walked end to end in step 10 against the built bundle rather than the dev server.
- **Verify a clone yourself**: the quick-start in the root [`README.md`](../../README.md) ends in `pnpm test:postman`, which is the executable half of that checklist.

What this deliverable deliberately does **not** include: the two frontend apps (ADR-0022 covers only their configuration), OpenAPI, i18n, and everything under _Planned_ above. Each ADR's §Consequences says where its own edges are, and ADR-0020 §Residual risks collects the security ones in one place.
