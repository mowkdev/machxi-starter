# Implementation plan — first deliverable

Scope: a running, testable API against a local Docker Postgres, with database setup, a seeded super admin, and full login / refresh / me / logout flows for both populations, verifiable via Postman and covered by automated tests. Frontends are out of scope beyond the rename/upgrade in ADR-0022.

## Readiness assessment (2026-08-17)

The ADR set (0001–0023) is sufficient to start implementation. Every decision needed for the first deliverable is made; the remaining open items are implementation details that do not block the build order below.

| Area | ADRs | Status |
|---|---|---|
| Tooling, layout, TS/ESLint baseline | 0002, 0003, 0021 | Ready. Lint rules that enforce ADRs are listed in ADR-0002. |
| Config, logging | 0004, 0005 | Ready. Full env variable list in ADR-0004. |
| DB, docker, migrations, seeds | 0006, 0007, 0008 | Ready. `citext` via migration 0000; roles are enums, so v1 seeds only the super admin (+ dev fixtures). |
| API architecture (layers, ctx, middleware, envelope, errors, lists, routes, health) | 0009–0016 | Ready. Functional style throughout; single `AppError` + factories. |
| Identity, auth, authz, security | 0017–0020 | Ready. `jose` for JWT, `@repo/crypto` for argon2/hashing, `now()` injected for tests. |
| Contracts package | 0023 | Ready. |
| Testing + Postman | 0021 | Ready; collection is produced during implementation. |

Known non-blocking open points (tracked as future ADRs in `docs/adr/README.md`): browser cookie transport, i18n, permissions, session-prune job, OpenAPI generation, CI pipeline.

## Endpoint scope for the first deliverable

```
GET  /health/live
GET  /health/ready
GET  /health

POST /api/v1/admin/auth/login
POST /api/v1/admin/auth/refresh
POST /api/v1/admin/auth/logout          (auth: staff)
POST /api/v1/admin/auth/logout-all      (auth: staff)
GET  /api/v1/admin/auth/me              (auth: staff)

POST /api/v1/user/auth/login
POST /api/v1/user/auth/refresh
POST /api/v1/user/auth/logout           (auth: user)
POST /api/v1/user/auth/logout-all       (auth: user)
GET  /api/v1/user/auth/me               (auth: user)
POST /api/v1/public/auth/register       (FEATURE_USER_REGISTRATION)

GET    /api/v1/admin/staff              (auth: staff; role admin)      list — pagination/filter/sort
POST   /api/v1/admin/staff              (role admin)                    create with initial password + roles
GET    /api/v1/admin/staff/:id          (role admin)
PATCH  /api/v1/admin/staff/:id          (role admin)                    profile, roles, status
POST   /api/v1/admin/staff/:id/sessions/revoke (role admin)

GET    /api/v1/admin/users              (role admin | manager)         list
POST   /api/v1/admin/users              (role admin)
GET    /api/v1/admin/users/:id          (role admin | manager)
PATCH  /api/v1/admin/users/:id          (role admin)
POST   /api/v1/admin/users/:id/sessions/revoke (role admin)

GET    /api/v1/user/profile             (auth: user)                    own profile
PATCH  /api/v1/user/profile             (auth: user)
POST   /api/v1/user/profile/change-password (auth: user)                revokes other sessions
```

`super_admin` passes every staff role check. The staff and users list endpoints exist mainly to prove the envelope/pagination/filter machinery end-to-end.

## Build order

Each step ends in a green `pnpm lint && pnpm check-types && pnpm test` and a commit.

1. ~~**Repo hygiene (ADR-0002, 0022)**~~ — **done 2026-08-18.** Removed `apps/blog`, renamed `storefront` → `web`, bumped to Node ≥22 / pnpm 10 / `.nvmrc`, tightened `@repo/typescript-config` (+ `node.json`), added `@repo/vitest-config` (`node.ts` / `react.ts`), deleted `jest-presets`, aligned `admin` to React 19 / Vite 7, added root `docker:*` (real) and `db:*` (placeholder) scripts. `@repo/logger` and `@repo/ui` now ship TypeScript source instead of a bunchee build (ADR-0002); `no-console` is live in `@repo/eslint-config`. The rest of the ADR-0002 lint-rules table lands with step 7, where `apps/api/src/core` exists to enforce it against.
2. ~~**`@repo/logger` (ADR-0005)**~~ — **done 2026-08-18.** pino 10 factory `createLogger({ level, pretty?, name?, redact?, destination? })`, `shouldPrettyPrint({ nodeEnv, isTty })` and `defaultRedactPaths` (credential keys at top level **and** one level deep — ADR-0005 amended), `Logger`/`LogLevel` types, 12 unit tests covering output shape, levels, child binding, `err` serialisation and redaction. `apps/web` dropped `@repo/logger` (pino is Node-only); `apps/api/src/index.ts` uses the factory until step 7 replaces it. `pino-http` and the context-bound child logger land with steps 7-8.
3. ~~**`@repo/crypto` (ADR-0018)**~~ — **done 2026-08-18.** `createArgon2Hasher(params)` → `{ hash, verify, needsRehash, dummyHash }` (argon2id via `argon2` 0.45, `hashLength` 32), plus `defaultArgon2Params` (65536/3/1, the single source for the ADR-0004 `ARGON2_*` defaults), `minArgon2Params`, `sha256Base64url` and `randomToken(bytes = 32)` with `min/maxTokenBytes` bounds. 39 unit tests. **ADR-0018 §Password hashing and ADR-0002 §Shared conventions were amended in place** (permitted pre-deliverable) to record four decisions the ADRs did not cover: `dummyHash()` lives on the hasher because equal login timing needs the *same* cost parameters; `verify` returns `false` only for an unreadable digest and rethrows operational failures; `needsRehash` also returns `true` for non-argon2id or unreadable digests (`argon2.needsRehash` ignores the algorithm and `argon2.verify` accepts argon2i/argon2d, so an imported hash would otherwise never be upgraded); and `createArgon2Hasher` rejects parameters below the OWASP floor, checked in the package because seeds bypass `core/config`. `argon2` is native, so it joins the root `pnpm.onlyBuiltDependencies` (prebuilt binary — no toolchain needed).
   - Hand-offs: **step 7** — `core/config` should build the `ARGON2_*` zod defaults from `defaultArgon2Params` rather than re-typing the literals, and mirror `minArgon2Params` as `.min()`; `tsdown` must mark `argon2` external (native CJS). **Step 8** — the container must `await hasher.dummyHash()` before the server binds, or the first unknown-email login is timing-distinguishable, and the login path should cap in-flight hashes (ADR-0020 §Hashing cost vs. liveness).
   - The security review's residual risks are now **recorded in the ADRs** rather than left here: ADR-0020's `Timing` row was corrected (refresh lookup is an indexed equality on the digest by design, so `crypto.timingSafeEqual` never applied) and gained a `Hashing cost vs. liveness` row for libuv threadpool saturation; ADR-0018 §Consequences records why there is no pepper in v1 and the residual timing gap after a parameter upgrade; ADR-0005 added `refreshTokenHash`/`previousRefreshTokenHash` to `defaultRedactPaths` (implemented in `@repo/logger`, 14 tests) and the rule that redaction does not reach pino's `err` serialiser; `docs/adr/README.md` tracks **Secret management and key rotation** as a planned ADR covering the JWT `kid` scheme and the argon2 pepper together.
4. ~~**`@repo/contracts` (ADR-0023)**~~ — **done 2026-08-18.** `packages/contracts`, zod 4 as its only dependency (no Node built-ins, no internal packages — enforced by a `no-restricted-imports` rule, not just by review). `enums.ts` (populations, staff/user roles and statuses as `as const` tuples for `pgEnum` + `z.enum` + client unions), `errors.ts` (the `ErrorCode` union with a status/meaning table per code, `ErrorDetail`, `ApiError`), `envelope.ts` (`Meta`/`SuccessEnvelope`/`ListEnvelope`/`ErrorEnvelope`, `Pagination`, `SortSpec`, narrowing guards, plus non-strict runtime schemas for the ADR-0021 conformance tests), `list-query.ts` (`FilterOp`, `Filter`, `ListQuery`, `Page<T>`, the `listQuerySchema` builder and `filtersToRecord`), `primitives.ts`, `health.ts`, and `auth/` `staff/` `users/` with zod request schemas + hand-written resource types. 115 unit tests.
   - **ADR-0014 and ADR-0023 were amended in place** (permitted pre-deliverable): `listQuerySchema` lives in contracts, not `core/http`, because ADR-0023 puts `listStaffQuery`/`listUsersQuery` there and they cannot be built otherwise — `applyListQuery`, the column map and the `id asc` tiebreaker stay API-side. ADR-0023 gained `primitives.ts`/`health.ts`, the "requests get schemas, responses get hand-written types" rule and the zod-4 pin. **ADR-0018** now states that `principal` is included on refresh and that registration returns `201 AuthResource`, creates a session and answers a duplicate email with generic `CONFLICT` (ADR-0020 §Enumeration), never `USER_EMAIL_TAKEN` — that code is reserved for the authenticated `POST /admin/users`. **ADR-0011** gained the `query parser` line below.
   - Hand-offs: **step 6** — `pgEnum` consumes the arrays from `@repo/contracts` (`db → contracts`, ADR-0002); enum **declaration order is the SQL sort order**, so it must not be reshuffled. **Step 7** — `createApp` must set the `qs`-based `query parser` (ADR-0011 amendment); without it every `filter[…]` list request 400s, because Express 5 defaults to `simple`. `core/http/list-query.ts` re-exports `listQuerySchema` and adds `applyListQuery`; `core/errors` builds its factories against the `ErrorCode` union; `respond.list` uses `filtersToRecord` for `meta.filters`. **Step 8** — `AuthResource` is the login/refresh/register body, `PrincipalResource` is what `/auth/me` returns (roles re-read from the DB, no `sessionId` on the wire). **Step 9** — the list allow-lists are already declared; the modules add only the column map.
5. ~~**Docker local (ADR-0007)**~~ — **done 2026-08-18.** `docker/local/compose.yaml` exactly as ADR-0007 specifies (postgres:16-alpine, `machxi-postgres`, `POSTGRES_*` from the root `.env`, named volume `machxi-local_postgres-data`, named network `machxi-local`, `pg_isready` healthcheck), `docker/local/postgres/init/01-test-db.sql` (`CREATE DATABASE machxi_test`, no extensions — migration 0000 owns `citext` per ADR-0008), root `.env.example` with every ADR-0004 variable plus the tooling-only `POSTGRES_*` / `DATABASE_URL_TEST`, and `docker/README.md` (scripts, what you get, connecting, configuration rules, troubleshooting). The `docker:*` scripts from step 1 now resolve. No optional pgadmin/adminer profile was added — the ADR leaves it optional and nothing needs it yet.
   - Verified against a real daemon, not just `compose config`: `docker:up` reaches `Healthy`; `machxi` and `machxi_test` both exist and are owned by `machxi`; `pg_extension` holds only `plpgsql`, confirming extensions are left to the migration; the published port answers from the host; a probe table survives `docker:down && docker:up` and is gone after `docker:reset`, which also re-runs the init script.
   - Deliberately **not** in this step: `apps/api/.env.test` (ADR-0004's third file). It carries the test config for the vitest run and belongs with `core/config` in step 7 — there is nothing to configure yet.
   - Hand-offs: **step 6** — `DATABASE_URL_TEST` is a tooling-only variable and must stay out of the API's zod schema (ADR-0004); `drizzle.config.ts` and the seed runner read the same root `.env`. **Step 7** — `core/config` builds `ARGON2_*` from `@repo/crypto`'s `defaultArgon2Params`, and `.env.example` already documents the OWASP floor, `UV_THREADPOOL_SIZE` (ADR-0020) and the `CORS_ORIGINS` dev defaults (ports 3001/3002 from ADR-0022). Any new variable is a three-place change: zod schema, `.env.example`, deployment secret store.
   - Known wrinkle, documented in `docker/README.md` rather than worked around: a plain `.sql` init file cannot read the compose variables, so `machxi_test` is a literal. Renaming `POSTGRES_DB` means editing the init script and `DATABASE_URL_TEST` too, then `pnpm docker:reset`.
   - The `adr-reviewer` pass found no code divergence but one **ADR defect**, now fixed in place (permitted pre-deliverable): ADR-0004 specified `FEATURE_USER_REGISTRATION: z.coerce.boolean()`, which is `Boolean(value)` over a string — `=false` parsed to `true`, so the flag could never be turned off and only an empty value produced `false`. Verified against the pinned zod 4.4.3 and **amended to `z.stringbool()`**, which also rejects typos instead of silently enabling the feature; the rule now covers every boolean variable. ADR-0004 also gained a precedence line (`apps/api/.env.test` wins over the root `.env` for `DATABASE_URL_TEST` during the vitest run, reconciling ADR-0004 §File layout with ADR-0021), and ADR-0007's prose was corrected from `--env-file ../../.env` to the `--env-file .env` the scripts actually use from the repo root.
   - Two more hand-offs to **step 7** from that review: `core/config` must **reject the committed `JWT_ACCESS_SECRET` placeholder when `NODE_ENV=production`** — `.env.example` ships a 41-character dev value so the `min(32)` rule is satisfiable out of the box, and a publicly known signing key must not be able to reach production; and `turbo.json` still declares no `env`/`globalEnv`, which ADR-0004 §Turbo requires for build-affecting variables. Neither is a violation yet (nothing consumes the variables and `.env*` is already in `build.inputs`), but both become one the moment `core/config` exists.
6. **`@repo/db` (ADR-0006, 0008)** — schema (`staff`, `staff_roles`, `users`, `user_roles`, `sessions`), `createDb`, migration 0000 (citext) + 0001 (schema), `migrate.ts`, seed runner + super admin seeder + dev fixtures, `db:*` scripts. Verify: `pnpm docker:up && pnpm db:setup`.
7. **API core (ADR-0003, 0004, 0009–0013)** — `main.ts`/`app.ts`/`server.ts`, config loader, request context + ALS, middleware (pino-http, context, helmet, cors, json, validate, notFound, errorHandler), envelope helpers, `AppError` + factories, container skeleton. Health module (ADR-0016). Integration tests: health, 404 envelope, validation envelope, DB-down exit.
   - Carried over from step 4: `createApp` sets the `qs`-based `query parser` (ADR-0011 amendment) — Express 5 defaults to `simple`, which flattens `filter[status][in]` into one literal key and makes every list request fail validation. `core/config` builds the `ARGON2_*` defaults from `@repo/crypto`'s `defaultArgon2Params` (step 3), and `core/errors` types its factories with the `ErrorCode` union from `@repo/contracts`.
   - Carried over from step 5: `core/config` must **reject the `.env.example` `JWT_ACCESS_SECRET` placeholder when `NODE_ENV=production`** — the committed dev value is 41 characters, so `min(32)` alone lets a publicly known signing key reach production. Boolean variables use `z.stringbool()`, **not** `z.coerce.boolean()` (ADR-0004 amended: the latter is `Boolean(value)` over a string, so `=false` was `true`). `turbo.json` still declares no `env`/`globalEnv`; ADR-0004 §Turbo requires build-affecting variables to be listed, which becomes a violation the moment `core/config` reads them. `apps/api/.env.test` (ADR-0004's third file) is created here, and it — not the root `.env` — is the `DATABASE_URL_TEST` the vitest `globalSetup` follows (ADR-0004 §File layout, amended).
   - Carried over from step 1's ADR review: `apps/api/src/index.ts` still reads `process.env.PORT` directly and the app is still Express 4 (`morgan`, `body-parser`, `res.json` in `server.ts`); `tsdown.config.ts` still emits CJS against ADR-0003's ESM `dist/main.js`. All of it is replaced here, along with the rest of the ADR-0002 lint-rules table.
8. **Auth (ADR-0017–0020)** — repositories (staff, users, sessions), principal adapters, token functions (`jose`), `createAuthService`, `createAuthController`, auth routers for both populations, `authenticate`/`authorize` middleware, rate limits. Integration tests per ADR-0021 list.
9. **Staff / users modules (ADR-0009, 0014)** — repositories with `applyListQuery`, services, controllers, routers; user profile endpoints; list-query tests.
10. **Postman (ADR-0021)** — collection + local environment with scripted token handoff; `newman` script; walk the acceptance checklist.
11. **Docs pass** — update `docs/adr/README.md` statuses (accepted → implemented notes where useful), root `README.md` quick-start, `docs/README.md`.

## Definition of done

- Acceptance checklist in ADR-0021 passes on a clean clone.
- Every ADR-referenced lint rule is active and the code base is clean under it.
- No `class`, `this`, `res.json` outside `core/http`, or `process.env` outside `core/config` in `apps/api/src`.
