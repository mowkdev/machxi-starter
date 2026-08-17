# Architecture Decision Records

This directory holds the Architecture Decision Records (ADRs) for the `machxi-starter` blueprint repository.

The repository is a Turborepo/pnpm monorepo intended as a bootstrap for projects that need an API, an admin panel, a web app and (later) a mobile app. ADRs capture the *why* behind the structure so that every project bootstrapped from this blueprint inherits the same conventions and can diverge deliberately rather than accidentally.

## Conventions

- One decision per file, numbered sequentially: `NNNN-short-kebab-title.md`.
- Format follows [ADR-0001](0001-record-architecture-decisions.md) (MADR-lite: Context, Decision, Consequences, Alternatives).
- Status is one of `proposed`, `accepted`, `deprecated`, `superseded by ADR-XXXX`.
- ADRs are immutable once accepted **and implemented**. Until the first deliverable ships, accepted ADRs may still be amended in place (the code does not exist yet, so there is nothing to supersede); after that, change is expressed by a superseding ADR.
- Code snippets in ADRs are illustrative of shape and naming; the implementation is the source of truth for details.

## Index

### Foundation

| # | Title | Status |
|---|-------|--------|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | accepted |
| [0002](0002-monorepo-layout-and-tooling.md) | Monorepo layout and tooling | accepted |
| [0003](0003-api-runtime-express-typescript.md) | API runtime: Express 5 on Node 22, TypeScript ESM | accepted |
| [0004](0004-configuration-and-environment.md) | Configuration and environment validation | accepted |
| [0005](0005-logging.md) | Structured logging with pino | accepted |

### Data

| # | Title | Status |
|---|-------|--------|
| [0006](0006-database-postgres-drizzle.md) | PostgreSQL with Drizzle ORM in a shared `@repo/db` package | accepted |
| [0007](0007-local-development-docker.md) | Local development infrastructure with Docker Compose | accepted |
| [0008](0008-database-migrations-and-seeding.md) | Database migrations, setup and seeding | accepted |

### API architecture

| # | Title | Status |
|---|-------|--------|
| [0009](0009-api-modular-layering.md) | Modular API: route → controller → service → repository (functional style) | accepted |
| [0010](0010-request-context.md) | Request context object and propagation | accepted |
| [0011](0011-middleware-pipeline.md) | Middleware pipeline: logging, validation, auth, errors | accepted |
| [0012](0012-response-envelope.md) | Unified response envelope | accepted |
| [0013](0013-error-model.md) | Error model and HTTP status mapping | accepted |
| [0014](0014-pagination-filtering-sorting.md) | Pagination, filtering and sorting conventions | accepted |
| [0015](0015-route-segments-and-versioning.md) | Route segments (`public` / `user` / `admin`) and API versioning | accepted |
| [0016](0016-health-checks.md) | Health check endpoints | accepted |

### Identity and access

| # | Title | Status |
|---|-------|--------|
| [0017](0017-identity-model-populations-and-roles.md) | Identity model: two populations (staff, users) with roles | accepted |
| [0018](0018-authentication-sessions-and-tokens.md) | Custom authentication: DB sessions, JWT access token, rotating refresh token | accepted |
| [0019](0019-authorization-guards.md) | Authorization guards (population + role) | accepted |
| [0020](0020-security-baseline.md) | API security baseline | accepted |

### Quality

| # | Title | Status |
|---|-------|--------|
| [0021](0021-testing-strategy.md) | Testing strategy (Vitest, supertest, Postman) | accepted |
| [0022](0022-frontend-apps.md) | Frontend apps: `web` (Next.js) and `admin` (Vite + React) | accepted |
| [0023](0023-shared-contracts-package.md) | Shared contracts package (`@repo/contracts`) | accepted |

### Planned (not yet written)

These will get their own ADRs when the corresponding features are implemented:

- Internationalization (message catalogs, `Accept-Language`, localized validation errors) — groundwork is already in ADR-0013 (machine-readable error codes).
- Browser token transport (httpOnly cookies for `web`/`admin`, CSRF) — see ADR-0018 §Consequences.
- Fine-grained permissions (permission table / policies) — see ADR-0017.
- Background jobs, email delivery, file storage.
- Mobile app.
- CI pipeline and deployment (Dockerfiles for `api`, `web`, `admin`).

## First deliverable

The ADRs listed above cover everything needed for the first deliverable: a running, testable API against a local Docker Postgres, with database setup and a seeded super admin, verifiable end-to-end via Postman (login, refresh, `me`, logout). ADR-0021 lists the acceptance checklist; [`docs/implementation-plan.md`](../implementation-plan.md) lists the build order, endpoint scope and readiness assessment.
