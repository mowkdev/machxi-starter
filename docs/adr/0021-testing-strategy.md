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

| Level            | What                                                                                | How                                                                                | DB                       |
| ---------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------ |
| Unit             | services, mappers, envelope/error helpers, guards, token service, list-query parser | fake repositories (in-memory implementations of repository interfaces), no Express | none                     |
| Integration      | repositories, auth flows, middleware order, envelope conformance                    | `supertest` against `createApp(buildContainer({ db: testDb }))`                    | `machxi_test` (ADR-0007) |
| Contract (later) | OpenAPI conformance                                                                 | generated schema vs responses                                                      | test                     |
| Manual / smoke   | end-to-end via Postman                                                              | collection in `docs/postman/`                                                      | dev                      |

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

**Amended 2026-08-18 (implementation step 8).** How the integration rules above
are actually met, now that there are fixtures to seed:

- **Seeding is per file, through the real seeders.** `globalSetup` still rebuilds
  the schema once; each file then calls `truncateAll` (`@repo/db/testing`) and
  `runSeeders([...baseSeeders, ...devSeeders])` (`@repo/db/seeds`) in its
  `beforeAll`. Both entry points were added for this. Running the real seeders
  rather than test-only inserts is what makes a broken seeder fail the suite
  instead of only a developer's first login.
- **The rate limits are effectively off in `.env.test`** and are covered by a
  dedicated file that builds apps with real limits. The memory store lives
  inside a limiter instance, which lives inside one app, so a count can never
  leak between files — but the auth suite logs in dozens of times from one
  address, which the production limit would correctly refuse.
- **Refresh-reuse detection gets its own app** with `refreshRotationGraceSec: 0`.
  Asserting it against the default 30-second window would mean sleeping, and a
  suite that sleeps is a suite people delete. The grace window's _own_ behaviour
  is asserted separately, with the default config.
- **The population parameterisation is `describe.each`** over a case object
  (segment base path, an active account, and a way to obtain a disabled one).
  The staff fixtures are all active by design, so the staff case disables one —
  which is also the state step 9's `PATCH /admin/staff/:id` will produce.
- **The root `test:int` runs with `--concurrency=1`.** `@repo/db` and `api` both
  point their integration suites at `DATABASE_URL_TEST` and both rebuild it in
  `globalSetup`, so running them in parallel means one suite drops the schema
  while the other is mid-run. This was always true and was hidden only by the
  API suite being short enough to finish first; step 8's suite is not. Turbo
  parallelises by default, so the serialisation has to be stated. The
  alternative — a second test database — buys parallelism the suites do not
  need and adds a variable to every environment.
- **Role-guard coverage waits for step 9.** ADR-0019 asks for a test that
  enumerates admin routes and asserts 401/403 for an unprivileged principal;
  step 8 has no role-guarded route to enumerate, so `authorize` is unit-tested
  and segment isolation is covered end to end. Adding a probe route to
  `createApp` to test it earlier would put a test seam in production wiring.

### Postman

`docs/postman/` contains:

- `machxi-api.postman_collection.json` — folders `Health`, `Admin Auth`, `User Auth`, `Admin › Staff`, `Admin › Users`; each request has tests asserting envelope shape and status; login/refresh scripts store `accessToken`/`refreshToken` into environment variables so the flow can be run top-to-bottom with the Collection Runner.
- `local.postman_environment.json` — `baseUrl=http://localhost:4000`, seeded super admin credentials placeholders (values come from `.env`, not committed).
- Runnable headless with `newman` (`pnpm test:postman`) as an optional smoke check.

**Amended 2026-08-18 (implementation step 10).** What was built, where it went
past the sketch above, and the one place the checklist below turned out to be
ambiguous:

- **Ten folders, not five.** `Health`, `Admin Auth`, `Admin › Staff`,
  `Admin › Users`, `Admin › Role guards`, `User Auth`, `User › Profile`,
  `Public`, `Errors & routing`, `Teardown` — 66 requests, 202 assertions. The
  five added ones are the surfaces that did not exist when this ADR was written:
  the role guards of ADR-0019, the profile endpoints of step 9, public
  registration, the failure branch of the envelope, and a teardown that logs
  every session out so a second run starts where the first did.
- **The envelope is asserted once, at collection level, for every response.**
  `success`, `data`/`error` exclusivity and `meta.requestId` (ADR-0012), plus
  `Cache-Control: no-store` on every 2xx (ADR-0020). Per-request tests then state
  only what is specific to them. Repeating the envelope assertions in 66 places
  would have meant 66 places to update and 65 chances to forget one.
- **"Old refresh → 401" needed a third rotation to be true.** Taken literally,
  step 4 of the checklist below describes a request that answers `200`: replaying
  the immediately previous refresh token inside `REFRESH_ROTATION_GRACE_SEC` is a
  legitimate retry by design (ADR-0018 §Refresh), and outside that window it
  answers `AUTH_REFRESH_REUSED` and revokes the session. Neither is what a smoke
  test should depend on — the first is a clock race, the second poisons every
  request after it. The collection therefore rotates **twice** and then presents
  the token the login issued: two rotations on, it is neither the session's
  current nor its previous token, so it is `AUTH_INVALID_REFRESH_TOKEN` with no
  reference to the clock. The checklist item is met; the reading that made it
  time-dependent is not the one to implement.
- **Repeatability was a design constraint, not a nicety.** Accounts the run
  creates carry a timestamped address, so a second run does not collide with the
  first; the only password it changes belongs to an account the same run created,
  never to a seeded fixture — changing `customer@machxi.local`'s password would
  make the collection pass once and fail forever after.
- **The teardown disables the three accounts each run creates**, because it
  cannot delete them — v1 has no delete endpoint. That is a security step and not
  housekeeping: one of the three is granted `manager`, all three hold a password
  committed in this repository, and `pnpm test:postman` can only be pointed at
  `localhost` but the Postman app can be pointed anywhere. A live account with a
  public password is a way in; a disabled one is a row. What accumulates on a dev
  database is disabled rows, cleared by `pnpm db:reset`.
- **The rate limits (ADR-0020) bound how often it can run**, and that is stated
  in `docs/postman/README.md` rather than discovered. One pass spends exactly one
  of the five failed refreshes per 15 minutes — which is why there is one
  deliberate refresh failure and not four — and 63 of the 300 global requests — the three
  health probes sit outside every limiter (ADR-0016).
  Roughly four consecutive runs per window against one process: the global
  limiter binds before the refresh one does.
- **`pnpm test:postman` is `scripts/postman.mjs`**, not a bare `newman run` line.
  It reads `SEED_SUPER_ADMIN_*` from `.env` and passes them as `--env-var`, which
  is what keeps the committed environment file free of credentials; a `$VAR` in
  the package script would expand in bash and not in the shell pnpm uses on
  Windows. It probes `/health/ready` first, so a stopped API produces one
  sentence naming the command that starts it rather than 66 connection errors,
  and it sets `process.exitCode` rather than calling `process.exit()` — killing
  the process while that probe still holds a socket trips a libuv assertion on
  Windows and replaces the exit code with a native crash code, which would make
  the script useless as a CI step. See ADR-0002 for why `scripts/` sits outside
  the workspaces.
- **`newman` is a root devDependency, and it is not cheap**: 108 transitive
  packages on every clone of a blueprint, for a check ADR-0021 itself calls
  optional. `pnpm dlx newman` would keep the lockfile clean, and it is the
  reasonable alternative if install time starts to matter. It was not chosen
  because an unpinned tool fetched at run time is exactly the kind of drift a
  lockfile exists to prevent, and because the smoke check should still work on a
  machine that is offline after `pnpm i`.

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
