# Architecture Decision Records

This directory holds the Architecture Decision Records (ADRs) for the `machxi-starter` blueprint repository.

The repository is a Turborepo/pnpm monorepo intended as a bootstrap for projects that need an API, an admin panel, a web app and (later) a mobile app. ADRs capture the _why_ behind the structure so that every project bootstrapped from this blueprint inherits the same conventions and can diverge deliberately rather than accidentally.

## Conventions

- One decision per file, numbered sequentially: `NNNN-short-kebab-title.md`.
- Format follows [ADR-0024](0024-adr-lifecycle.md) (MADR-lite: Context, Decision, Consequences, Alternatives — unchanged from the superseded ADR-0001).
- **The lifecycle is [ADR-0024](0024-adr-lifecycle.md)** — statuses, when an ADR may be amended in place and when it must be superseded. In short: status is one of `proposed`, `accepted`, `deprecated`, `superseded by ADR-XXXX`; an accepted ADR with code standing on it is immutable, and change is expressed by a superseding ADR that carries the whole decision.
- **The amendment window is scoped to a deliverable** ([ADR-0025](0025-deliverables.md) rule 2), not to a date. An ADR may be amended in place only while the deliverable it was written for is `in progress` in [`docs/plan/README.md`](../plan/README.md); once that deliverable ships, the ADR changes only through a superseding ADR that carries the whole decision.
  - **D1 shipped 2026-08-18**, so ADRs 0001–0024 are closed. The amendments dated _2026-08-18 (step N)_ inside them were made under the exception ADR-0024 rule 2 grants and are the last of their kind for those records.
  - **D2 is in progress**, so ADRs 0025–0029 are amendable, labelled `**Amended YYYY-MM-DD (D2.N).**` at the point of change.
- "Implemented" is not a status — it is the _Implemented_ column below, which names the plan step that built the decision and where the code lives (ADR-0024 §Lifecycle rule 4). Steps are written `D<deliverable>.<step>` (ADR-0025 §Step identity).
- Code snippets in ADRs are illustrative of shape and naming; the implementation is the source of truth for details.

## Index

_Implemented_ names the build-order step from the deliverable's plan in [`docs/plan/`](../plan/README.md) and the code that answers to the ADR. Where an ADR was implemented across several steps, all of them are listed — the decision was made once, but the surface it governs grew. A cell that names a deliverable without a step is a decision that is agreed but not yet built.

### Foundation

| #                                                    | Title                                                      | Status                                          | Implemented                                                                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [0001](0001-record-architecture-decisions.md)        | Record architecture decisions                              | superseded by [ADR-0024](0024-adr-lifecycle.md) | superseded 2026-08-18 — practice and format carried forward unchanged                                                   |
| [0002](0002-monorepo-layout-and-tooling.md)          | Monorepo layout and tooling                                | accepted                                        | D1.1 — workspace layout, shared configs; the bundling rules came from D1.7 and the root `scripts/` carve-out from D1.10 |
| [0003](0003-api-runtime-express-typescript.md)       | API runtime: Express 5 on Node 22, TypeScript ESM          | accepted                                        | D1.7 — `apps/api` (`main.ts` startup sequence, `app.ts`, `server.ts` drain)                                             |
| [0004](0004-configuration-and-environment.md)        | Configuration and environment validation                   | accepted                                        | D1.7 — `apps/api/src/core/config` (`.env.example` itself dates from D1.5)                                               |
| [0005](0005-logging.md)                              | Structured logging with pino                               | accepted                                        | D1.2 — `@repo/logger`; D1.7 — `pino-http` + the context-bound child logger                                              |
| [0024](0024-adr-lifecycle.md)                        | ADR lifecycle: format, statuses and how a decision changes | accepted                                        | D1.11 — this index and its _Implemented_ column; supersedes ADR-0001                                                    |
| [0025](0025-deliverables.md)                         | Deliverables: the unit of staged work                      | accepted                                        | D2 — `docs/plan/` and its ledger; the `D<n>.<step>` form in this column                                                 |
| [0026](0026-task-graph-caching-and-serialisation.md) | Turborepo task graph: caching and serialisation            | accepted                                        | D2.1 — `turbo.json`, the root and `@repo/db` `test` scripts                                                             |

### Data

| #                                               | Title                                                      | Status   | Implemented                                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| [0006](0006-database-postgres-drizzle.md)       | PostgreSQL with Drizzle ORM in a shared `@repo/db` package | accepted | D1.6 — `packages/db` (`src/schema`, `createDb`)                                                               |
| [0007](0007-local-development-docker.md)        | Local development infrastructure with Docker Compose       | accepted | D1.5 — `docker/local` and the compose setup the D1.1 `docker:*` scripts drive                                 |
| [0008](0008-database-migrations-and-seeding.md) | Database migrations, setup and seeding                     | accepted | D1.6 — committed migrations and idempotent seeders behind the `db:*` scripts (D1.8 added `db:sessions:prune`) |

### API architecture

| #                                             | Title                                                                     | Status   | Implemented                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| [0009](0009-api-modular-layering.md)          | Modular API: route → controller → service → repository (functional style) | accepted | D1.7–D1.9 — `apps/api/src/modules/{health,auth,staff,users}`, `core/container.ts`                                        |
| [0010](0010-request-context.md)               | Request context object and propagation                                    | accepted | D1.7 — `core/context` (ALS + `req.ctx`); D1.8 re-binds the logger to the principal                                       |
| [0011](0011-middleware-pipeline.md)           | Middleware pipeline: logging, validation, auth, errors                    | accepted | D1.7 — logging, validate, no-store, 404, error handler; D1.8 — `authenticate`, `authorize`, rate limits                  |
| [0012](0012-response-envelope.md)             | Unified response envelope                                                 | accepted | D1.7 — `core/http` (`respond.*`, `sendErrorEnvelope`)                                                                    |
| [0013](0013-error-model.md)                   | Error model and HTTP status mapping                                       | accepted | D1.7 — `core/errors` (branded `AppError` + factories)                                                                    |
| [0014](0014-pagination-filtering-sorting.md)  | Pagination, filtering and sorting conventions                             | accepted | D1.4 — `listQuerySchema` in `@repo/contracts`; D1.7 — `applyListQuery`; D1.9 — live on `/admin/staff` and `/admin/users` |
| [0015](0015-route-segments-and-versioning.md) | Route segments (`public` / `user` / `admin`) and API versioning           | accepted | D1.7 — `apps/api/src/routes`                                                                                             |
| [0016](0016-health-checks.md)                 | Health check endpoints                                                    | accepted | D1.7 — `modules/health`                                                                                                  |

### Identity and access

| #                                                    | Title                                                                        | Status       | Implemented                                                                                                                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [0017](0017-identity-model-populations-and-roles.md) | Identity model: two populations (staff, users) with roles                    | accepted     | D1.6 — the tables and enums; D1.8–D1.9 — the `PrincipalAdapter` and the last-super-admin invariant                                                                 |
| [0018](0018-authentication-sessions-and-tokens.md)   | Custom authentication: DB sessions, JWT access token, rotating refresh token | accepted     | D1.3 — `@repo/crypto`; D1.8 — `modules/auth` (`jose` HS256, rotating refresh, reuse detection)                                                                     |
| [0019](0019-authorization-guards.md)                 | Authorization guards (population + role)                                     | accepted     | D1.8 — `core/middleware/authorize.ts`, `core/auth/policies.ts`; D1.9 — mounted, with the route-by-route guard matrix test                                          |
| [0020](0020-security-baseline.md)                    | API security baseline                                                        | accepted     | D1.7–D1.9 — helmet/CORS/body limits, the three rate limiters, the argon2 concurrency cap, `no-store` on every router; §Residual risks lists what v1 does not cover |
| [0027](0027-credential-self-service-and-reset.md)    | Credential self-service and administrative password reset                    | accepted     | D2.3 — `/api/v1/admin/profile` and `POST /admin/{staff,users}/:id/password`                                                                                        |
| [0028](0028-account-deletion.md)                     | Account deletion: soft for users, hard for staff                             | accepted     | D2.4 — `DELETE /admin/{staff,users}/:id`, migration `0002` (partial unique index on `users.email`)                                                                 |
| [0029](0029-browser-token-transport.md)              | Browser token transport: httpOnly refresh cookie and CSRF                    | **proposed** | D2.5 (not yet built) — gated on acceptance; ADR-0018 §Token transport delegates this decision                                                                      |

### Quality

| #                                        | Title                                                     | Status   | Implemented                                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [0021](0021-testing-strategy.md)         | Testing strategy (Vitest, supertest, Postman)             | accepted | D1.1 — `@repo/vitest-config`; every step since — the suites; D1.10 — `docs/postman` + `pnpm test:postman`                                              |
| [0022](0022-frontend-apps.md)            | Frontend apps: `web` (Next.js) and `admin` (Vite + React) | accepted | D1.1 — the rename, the React 19 / Vite 7 alignment and the port split; **D3** for the apps themselves, which no ADR has decided the feature surface of |
| [0023](0023-shared-contracts-package.md) | Shared contracts package (`@repo/contracts`)              | accepted | D1.4 — `packages/contracts` (enums, envelope, error codes, request schemas, resource types)                                                            |

### Planned (not yet written)

These will get their own ADRs when the corresponding features are implemented:

- Internationalization (message catalogs, `Accept-Language`, localized validation errors) — groundwork is already in ADR-0013 (machine-readable error codes).
- Fine-grained permissions (permission table / policies) — see ADR-0017.
- **`packages/ui` and the design system.** It is still Turborepo template scaffolding (`counter-button`, `link`), both frontend apps already depend on it, and nothing decides styling, component conventions, or whether the package survives at all. This is a product and design decision rather than an engineering one, which is why no draft exists; it is D3's first step (`docs/plan/README.md` §What blocks D3).
- **Step-up authentication / re-authentication as a category.** ADR-0027 requires the actor's own password on an administrative reset because it is the only such mechanism available. A real one would replace that, and would be the right fence for ADR-0028's delete endpoints too.
- **Forced password change at next sign-in** (`must_change_password`) — needs a column, a migration and a branch in `authenticate`; ADR-0027 §Decision rule 4 states why it was not bolted on.
- **Email-based password reset** — needs email delivery, a single-use reset-token table, and the `3 / hour` limiter ADR-0020 §Rate limiting already reserves. See ADR-0027 §Out of scope.
- **Retention for soft-deleted accounts.** ADR-0028 keeps deleted user rows forever by design; how long personal data is kept is a compliance decision nothing has made.
- **Secret management and key rotation** — a `kid` scheme for `JWT_ACCESS_SECRET` when moving to asymmetric signing, and an argon2 **pepper** (`argon2`'s `secret` option). Both need the same key-id/overlap machinery, and rotating a pepper forces rehash-on-next-login, so they are one decision — see ADR-0018 §Consequences.
- **Scheduling the session prune.** `pnpm db:sessions:prune` exists (ADR-0008, D1.8) and expired rows accumulate until something runs it. What is undecided is _what_ runs it — cron, the platform's scheduler, or an in-process timer — which is the same decision as background jobs below.
- **OpenAPI generation** from `@repo/contracts`, and the contract-conformance test tier ADR-0021 leaves as "later". Until then the Postman collection is the API's documentation.
- **Shared rate-limit state.** The ADR-0020 limiters use an in-memory store, which counts per process; more than one API instance multiplies every limit by the instance count. A shared store is a deployment decision and belongs with the CI/deployment ADR.
- Background jobs, email delivery, file storage.
- Mobile app.
- CI pipeline and deployment (Dockerfiles for `api`, `web`, `admin`).

## Deliverables

The ledger is [`docs/plan/README.md`](../plan/README.md), and [ADR-0025](0025-deliverables.md) defines what a deliverable is and how it binds the lifecycle above.

**D1 — API foundation, shipped 2026-08-18.** A running, testable API against a local Docker Postgres, with database setup, a seeded super admin, both authentication flows, the staff/users admin resources and the user profile — verifiable end-to-end via Postman and covered by automated tests.

- **Endpoint surface and build order**: [`docs/plan/0001-api-foundation.md`](../plan/0001-api-foundation.md), D1.1–D1.11, all closed.
- **Acceptance checklist**: ADR-0021 §Acceptance checklist, walked end to end in D1.10 against the built bundle rather than the dev server.
- **Verify a clone yourself**: the quick-start in the root [`README.md`](../../README.md) ends in `pnpm test:postman`, which is the executable half of that checklist.

**D2 — API hardening and D3 prerequisites, in progress.** Closes the gaps D1's review found — a cacheable integration-test gate, a CORS wildcard that blocks instead of allowing, no way for staff to change a password, a soft-delete read path with no write path — and makes the transport decision the frontend apps cannot start without. Plan: [`docs/plan/0002-api-hardening.md`](../plan/0002-api-hardening.md).

What D1 deliberately did **not** include: the two frontend apps (ADR-0022 covers only their configuration), OpenAPI, i18n, and everything under _Planned_ above. Each ADR's §Consequences says where its own edges are, and ADR-0020 §Residual risks collects the security ones in one place.
