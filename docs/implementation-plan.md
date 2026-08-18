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
3. ~~**`@repo/crypto` (ADR-0018)**~~ — **done 2026-08-18.** `createArgon2Hasher({ memoryKib, timeCost, parallelism })` returning `{ hash, verify, needsRehash, dummyHash }` (argon2id via `argon2` 0.45; defaults 65536/3/1 mirror the `ARGON2_*` env defaults, exported as `defaultArgon2Params`), `sha256Base64url` for refresh-token storage and `randomToken(bytes = 32)` → base64url. 26 unit tests. Two notes for later steps: `verify` returns `false` rather than throwing on an unreadable stored hash so a corrupt row cannot 500 a login; `dummyHash()` is the memoised same-parameters hash that login verifies against for unknown emails (ADR-0018 login step 2) — an addition to the ADR's three-function list, since equal timing requires the *same* cost parameters. `argon2` is a native module, so it is now listed in the root `pnpm.onlyBuiltDependencies` (prebuilt binary, no local toolchain needed). Consumers wire in at steps 6 (seeds) and 8 (auth).
4. **`@repo/contracts` (ADR-0023)** — envelope/error/pagination types, enums, auth/staff/users schemas.
5. **Docker local (ADR-0007)** — `docker/local/compose.yaml`, init script for `machxi_test`, root `.env.example`, `docker/README.md`.
6. **`@repo/db` (ADR-0006, 0008)** — schema (`staff`, `staff_roles`, `users`, `user_roles`, `sessions`), `createDb`, migration 0000 (citext) + 0001 (schema), `migrate.ts`, seed runner + super admin seeder + dev fixtures, `db:*` scripts. Verify: `pnpm docker:up && pnpm db:setup`.
7. **API core (ADR-0003, 0004, 0009–0013)** — `main.ts`/`app.ts`/`server.ts`, config loader, request context + ALS, middleware (pino-http, context, helmet, cors, json, validate, notFound, errorHandler), envelope helpers, `AppError` + factories, container skeleton. Health module (ADR-0016). Integration tests: health, 404 envelope, validation envelope, DB-down exit.
   - Carried over from step 1's ADR review: `apps/api/src/index.ts` still reads `process.env.PORT` directly and the app is still Express 4 (`morgan`, `body-parser`, `res.json` in `server.ts`); `tsdown.config.ts` still emits CJS against ADR-0003's ESM `dist/main.js`. All of it is replaced here, along with the rest of the ADR-0002 lint-rules table.
8. **Auth (ADR-0017–0020)** — repositories (staff, users, sessions), principal adapters, token functions (`jose`), `createAuthService`, `createAuthController`, auth routers for both populations, `authenticate`/`authorize` middleware, rate limits. Integration tests per ADR-0021 list.
9. **Staff / users modules (ADR-0009, 0014)** — repositories with `applyListQuery`, services, controllers, routers; user profile endpoints; list-query tests.
10. **Postman (ADR-0021)** — collection + local environment with scripted token handoff; `newman` script; walk the acceptance checklist.
11. **Docs pass** — update `docs/adr/README.md` statuses (accepted → implemented notes where useful), root `README.md` quick-start, `docs/README.md`.

## Definition of done

- Acceptance checklist in ADR-0021 passes on a clean clone.
- Every ADR-referenced lint rule is active and the code base is clean under it.
- No `class`, `this`, `res.json` outside `core/http`, or `process.env` outside `core/config` in `apps/api/src`.
