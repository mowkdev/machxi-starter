# ADR-0021: Testing strategy (Vitest, supertest, Postman)

- Status: accepted
- Date: 2026-08-17

## Context

The starter uses Jest + ts-jest, which needs extra configuration for ESM/`NodeNext` and is slower. The API's layering (ADR-0009) is designed for fast unit tests of services and repository/integration tests against a real Postgres. The first deliverable must also be verifiable manually via Postman.

## Decision

### Runner

- **Vitest** replaces Jest. `packages/config-vitest/` exports base configs (`node.ts`, `react.ts`); `packages/jest-presets` is deleted.
- Scripts: `test` (all), `test:unit`, `test:int` (integration, requires DB), `test:watch`.

### Test pyramid for the API

| Level | What | How | DB |
|---|---|---|---|
| Unit | services, mappers, envelope/error helpers, guards, token service, list-query parser | fake repositories (in-memory implementations of repository interfaces), no Express | none |
| Integration | repositories, auth flows, middleware order, envelope conformance | `supertest` against `createApp(buildContainer({ db: testDb }))` | `machxi_test` (ADR-0007) |
| Contract (later) | OpenAPI conformance | generated schema vs responses | test |
| Manual / smoke | end-to-end via Postman | collection in `docs/postman/` | dev |

Integration test rules:

- `globalSetup` runs migrations against `DATABASE_URL_TEST` (from `apps/api/.env.test`), truncates tables between test files, seeds a super admin and fixtures via the same seeders (ADR-0008) — tests exercise the real seed path.
- Tests run serially per file against the DB (`pool: 'forks'`, `fileParallelism: false` for `test:int`); unit tests run fully parallel.
- Each integration file gets a fresh app instance; no shared module-level state.

Minimum integration coverage for the first deliverable:

- `/health/live` 200; `/health/ready` 200 with db, 503 with a broken db url.
- Envelope: unknown route → 404 error envelope with `requestId`; validation failure → 400 with `details`.
- Staff auth: login ok / wrong password / disabled account; `me`; refresh rotates and old token fails; reuse detection revokes; logout → subsequent `me` 401.
- Same suite for user auth (shared test factory parameterised by population).
- Segment isolation: user token on `/admin/auth/me` → 401; staff without role on `/admin/staff` → 403; super admin → 200.
- List endpoint (`/admin/users`): pagination meta, sort, filter, invalid sort field → 400.
- Seed idempotency: running seeders twice yields one super admin.

### Postman

`docs/postman/` contains:

- `machxi-api.postman_collection.json` — folders `Health`, `Admin Auth`, `User Auth`, `Admin › Staff`, `Admin › Users`; each request has tests asserting envelope shape and status; login/refresh scripts store `accessToken`/`refreshToken` into environment variables so the flow can be run top-to-bottom with the Collection Runner.
- `local.postman_environment.json` — `baseUrl=http://localhost:4000`, seeded super admin credentials placeholders (values come from `.env`, not committed).
- Runnable headless with `newman` (`pnpm test:postman`) as an optional smoke check.

### Acceptance checklist for the first deliverable

1. `pnpm i && cp .env.example .env && pnpm docker:up` — Postgres healthy.
2. `pnpm db:setup` — migrations applied, super admin seeded (log confirms).
3. `pnpm dev --filter api` — logs "database connected", "listening on :4000"; with Postgres stopped the process exits non-zero with a clear error.
4. Postman: `GET /health/ready` 200 → `POST /api/v1/admin/auth/login` 200 with tokens → `GET /api/v1/admin/auth/me` 200 → `POST /refresh` 200 (new tokens; old refresh → 401) → `POST /logout` 204 → `me` 401.
5. `pnpm test` green (unit + integration).
6. `pnpm lint && pnpm check-types` clean.

## Consequences

- Fast unit loop; realistic integration tests using the real seed and migration paths.
- Postman collection doubles as living documentation until OpenAPI is generated.
- Test DB requires Docker running for `test:int` (CI uses a Postgres service container).

## Alternatives considered

- Keep Jest: workable, but ESM friction and slower; Vitest is the current default for TS monorepos.
- Testcontainers: nice isolation; adopt later if the shared compose test DB becomes a bottleneck.
- Mock the DB in integration tests: defeats the purpose; repositories are where SQL bugs live.
