# D2 — API hardening and D3 prerequisites

- Status: **in progress**, opened 2026-08-18
- Steps: `D2.1` – `D2.6`
- Ledger: [`docs/plan/README.md`](README.md)

Scope: close the gaps a technical review of D1 found, and make the decisions the frontend apps cannot start without. No new product surface beyond what the ADRs below decide; every step exists because something is either wrong, missing, or undecided.

Each step names the ADRs that govern it. Read them before implementing — they carry the reasoning, this file carries the work. Every step ends green on `pnpm lint && pnpm check-types && pnpm test` and a conventional commit.

**Amendment window.** ADRs 0025–0029 were written for this deliverable and may be amended in place while it is in progress, labelled `**Amended YYYY-MM-DD (D2.N).**` at the point of change ([ADR-0025](../adr/0025-deliverables.md) rule 2). ADRs 0001–0024 belong to D1 and are closed: if the work below needs one of them to say something different, stop and write a superseding ADR ([ADR-0024](../adr/0024-adr-lifecycle.md) rule 1).

## Build order

### 1. Task graph, caching and serialisation

**ADRs:** [0026](../adr/0026-task-graph-caching-and-serialisation.md), [0021](../adr/0021-testing-strategy.md) §Runner, [0004](../adr/0004-configuration-and-environment.md) §Turbo, [0002](../adr/0002-monorepo-layout-and-tooling.md) §Toolchain versions

First, because it is the step that makes every later step's green mean something. `apps/api`'s `test` script runs unit **and** integration (ADR-0021 §Runner), and `turbo.json` marks `test` cacheable with no `env`, so the gate replays a cached pass for a suite that never opened a database connection. Verified on 2026-08-18: `pnpm test` reported `Cached: 6 cached, 8 total` with `api:test` among them.

- `turbo.json` — `test` gets `"cache": false` and `"env": ["DATABASE_URL", "DATABASE_URL_TEST"]`; `test:int` gets the same `env` at root (today only `apps/api/turbo.json` declares it); `test:unit` stays cacheable and gains nothing. Add `"globalEnv": ["NODE_ENV"]`, which is the minimum ADR-0004 §Turbo has been owed since `core/config` landed in D1.7 — declare more only for a variable something actually reads.
- `package.json` (root) — `"test": "turbo run test --concurrency=1"`, for the reason ADR-0021's D1.8 amendment gives for `test:int`: both `@repo/db` and `api` rebuild `DATABASE_URL_TEST` in `globalSetup`, and in parallel one drops the schema while the other is mid-run.
- `packages/db/package.json` — `"test": "vitest run && vitest run --config vitest.int.config.ts"`. It has three integration files behind `test:int` and excludes them from `test`, which is not what ADR-0021 §Runner defines `test` to be. This is why the race above is currently unreachable, and why it becomes reachable the moment this line is fixed — hence the `--concurrency=1` in the same step.

**Done when:** `pnpm test` run twice in a row reports no cache hit for any `test` task both times; `pnpm test:unit` run twice does hit cache the second time; `pnpm test` is green with Postgres up and fails (rather than passing from cache) with Postgres down.

### 2. Conformance and hygiene fixes

**ADRs:** [0020](../adr/0020-security-baseline.md) §CORS, [0002](../adr/0002-monorepo-layout-and-tooling.md)

Three small divergences, none of which needs a decision — the decisions exist and the code does not match them.

- **`CORS_ORIGINS=*` silently blocks every origin.** `apps/api/src/core/config/schema.ts` accepts `z.literal("*")` as an allow-list entry and a `.refine` rejects it only when `NODE_ENV=production`, which is ADR-0020 §CORS ("No `*` in production") implemented faithfully. But `apps/api/src/app.ts` passes the array straight to `cors({ origin: [...] })`, and `cors` does exact-string matching on array entries, so `"*"` matches no `Origin` header ever: setting it produces the exact opposite of intent, with no error. Map a list containing `"*"` to `origin: true` before handing it to `cors`. Cover it with a test that asserts `Access-Control-Allow-Origin` for a wildcard config, an allow-listed origin, and an empty list.
- **`apps/web/next-env.d.ts` is committed and rewritten by `check-types`.** `web`'s `check-types` runs `next typegen`, which rewrites the file (`.next/types` → `.next/dev/types` depending on which build ran last), so the documented gate dirties the working tree on every run — it is dirty in the repository right now. Add it to `.gitignore` and `git rm --cached` it. `.next` is already ignored.
- **`packages/ui/eslint.config.mjs` is the only one of its kind.** Every other package uses `eslint.config.js`, and the package is `"type": "module"`, so the extension buys nothing. Rename it.

**Done when:** the three CORS cases are asserted by tests; `pnpm check-types` twice in a row leaves `git status` clean; no `eslint.config.mjs` remains.

### 3. Credential self-service and administrative password reset

**ADRs:** [0027](../adr/0027-credential-self-service-and-reset.md), [0017](../adr/0017-identity-model-populations-and-roles.md) §Invariants, [0018](../adr/0018-authentication-sessions-and-tokens.md) §Staff onboarding, [0019](../adr/0019-authorization-guards.md), [0023](../adr/0023-shared-contracts-package.md)

Staff have no way to change their own password and nobody has a way to reset one. `staffRepository.updatePasswordHash` already exists (built for the login-time argon2 upgrade), so this adds routes, not capability.

Contracts (`packages/contracts`):

- Move `changePasswordBody` from `src/users/schemas.ts` to `src/auth/schemas.ts`; re-export from both `users/` and `staff/`. It is a credential shape used by two populations, so ADR-0023's "defined once" rule decides where it lives.
- Add `setPasswordBody` — `{ password: passwordSchema, currentPassword: presentedPasswordSchema }`.
- Rename `USER_CURRENT_PASSWORD_INVALID` to `AUTH_CURRENT_PASSWORD_INVALID` in `src/errors.ts`, moving it from the resource-code list to the auth-code list and updating its doc-table row. Status stays `403`.

API (`apps/api`):

- `modules/auth/auth.service.ts` — `REVOKE_REASONS.passwordReset: "password_reset"`.
- `modules/staff/` — add `getProfile`, `updateProfile`, `changePassword` and `setPassword` to `staff.service.ts`; a `createStaffProfileController` alongside the existing controller; a `createStaffProfileRouter` and a `POST /:id/password` route; schemas and a renamed error factory. Mirror the users module's two-controller shape exactly — one service, two controllers, so the admin handlers are unreachable from the self-service router.
- `modules/users/` — add `setPassword` and `POST /:id/password` behind `authorize("admin")`; rename the error factory.
- `routes/admin.router.ts` — mount `/profile` after `authenticate("staff")` **without** `authorize`: every staff role may change its own password, and there is no `:id` to compare (ADR-0019 §3).
- `core/container.ts` — build and expose the staff profile controller.

Rules that must be tested, not just implemented (all from ADR-0027 §Decision):

- The actor's own `currentPassword` is required on `POST /:id/password`, and a wrong one answers `AUTH_CURRENT_PASSWORD_INVALID`.
- `assertMayActOnSuperAdmin` guards the staff reset — an `admin` cannot set a `super_admin`'s password.
- A reset revokes **every** session of the subject with reason `password_reset`; a self-service change revokes every session **except** the caller's, with reason `password_changed`.
- An account whose `password_hash` is `null` cannot use `change-password`.

Postman: add the four endpoints, and keep the collection repeatable — change or reset only passwords of accounts the same run created, never a seeded fixture (ADR-0021, D1.10 amendment).

**Done when:** the rules above are covered by integration tests for both populations; the guard matrix test enumerates the new routes; `pnpm test:postman` green.

### 4. Account deletion

**ADRs:** [0028](../adr/0028-account-deletion.md), [0006](../adr/0006-database-postgres-drizzle.md), [0008](../adr/0008-database-migrations-and-seeding.md), [0017](../adr/0017-identity-model-populations-and-roles.md)

D1 built the whole read half of soft deletion and nothing that writes it. Use `/db-schema-change` for the migration.

Schema and migration (`packages/db`):

- `src/schema/users.ts` — replace `email: citext().notNull().unique()` with a **partial** unique index in the table extras: `unique (email) where deleted_at is null`.
- Generate `migrations/0002_*.sql` with `drizzle-kit generate` and review it: it must drop the existing `users_email_unique` constraint and create the partial index. Never `push`, never edit a committed migration.

API (`apps/api`):

- `modules/users/users.repository.ts` — `onConflictDoNothing` must target the partial index (`targetWhere: isNull(users.deletedAt)`). **This is the load-bearing edit of the step:** left unqualified, the insert matches no index, the unique violation escapes, and a duplicate registration answers `500` instead of `CONFLICT`. Add `softDelete`.
- `modules/staff/staff.repository.ts` — add `remove` (hard delete).
- `modules/users/users.service.ts` — `remove`: one transaction setting `deleted_at`, setting `status = 'disabled'`, and revoking every session with reason `account_deleted`. Refuse `update`, `revokeSessions` and `setPassword` on a soft-deleted subject with `USER_DELETED` (409); leave `getById` reading through `findAnyById` unchanged.
- `modules/staff/staff.service.ts` — `remove`: take `lockRoleInvariant` first, then the rank guard, the last-super-admin invariant (`STAFF_LAST_SUPER_ADMIN`), a plain `403` for self-deletion, session revocation, and the row delete — all in one transaction.
- Routes — `DELETE /:id` on both resources, `authorize("admin")`, answering `204`.
- Contracts — `USER_DELETED` (409) joins the error-code union with its table row.
- `modules/auth/auth.service.ts` — `REVOKE_REASONS.accountDeleted: "account_deleted"`.

Postman: the teardown folder deletes the accounts each run creates instead of disabling them. ADR-0021's D1.10 amendment settled for disabling "because it cannot delete them — v1 has no delete endpoint"; that constraint is gone. **ADR-0021 is frozen** (D1), so the collection changes and the ADR does not — this note is the record.

**Done when:** a deleted user's address can be re-registered; two rows may share an address with at most one live; writes to a deleted user answer `409 USER_DELETED` while `GET` still answers `200`; deleting the last active super admin is refused; deleting a staff member revokes their sessions in the same transaction; `pnpm db:reset` replays cleanly from migration `0000`.

### 5. Browser token transport — **gated**

**ADRs:** [0029](../adr/0029-browser-token-transport.md) (`proposed`), [0018](../adr/0018-authentication-sessions-and-tokens.md) §Token transport, [0020](../adr/0020-security-baseline.md) §CORS

> **Do not start this step until ADR-0029 is `accepted`.** It changes `AuthResource`, a published contract, and moves a security boundary. If the proposal is rejected or altered, this step is rewritten from whatever replaces it.

Implements ADR-0029 as written: `X-Auth-Transport` opt-in; the refresh token in a `__Secure-machxi.refresh` cookie scoped per segment; a double-submit CSRF token on `refresh`, `logout` and `logout-all`; `AuthResource.refreshToken` and `refreshBody.refreshToken` become optional; `CSRF_TOKEN_INVALID` (403) joins the error codes; `logout` clears both cookies. New middleware at `apps/api/src/core/middleware/csrf.ts`.

The integration suite is already parameterised by population (ADR-0021, D1.8 amendment); transport is a second axis on the same `describe.each` case object. Postman stays on `body` transport, which keeps the collection an accurate description of what a mobile client does.

**Done when:** both transports pass the full auth suite for both populations; a cookie-transport response body contains no `refreshToken`; a cookie-driven refresh without `X-CSRF-Token` answers `403`.

### 6. Close-out

**ADRs:** [0025](../adr/0025-deliverables.md) rule 4, [0021](../adr/0021-testing-strategy.md) §Acceptance checklist

- Fill the _Implemented_ column in `docs/adr/README.md` for every ADR this deliverable built, in `D2.N` form.
- Sync `.env.example`, `CLAUDE.md` and `docs/README.md` with anything the steps changed.
- Run the acceptance checklist below on a fresh clone.
- Move the D2 row in `docs/plan/README.md` to `shipped YYYY-MM-DD`, which shuts the amendment window on ADRs 0025–0029.

## Definition of done

D2 is closed when every step above is closed and this checklist passes on a fresh clone:

1. `pnpm i && cp .env.example .env && pnpm docker:up` — Postgres healthy.
2. `pnpm db:setup` — migrations through `0002` applied, super admin seeded.
3. `pnpm lint && pnpm check-types` clean, and `git status` clean afterwards.
4. `pnpm test` green — and demonstrably not from cache: run it twice and watch both runs execute.
5. `pnpm dev --filter api`, then `pnpm test:postman` green.
6. Stop Postgres and re-run `pnpm test` — it fails. A gate that cannot fail is not a gate, and this is the specific defect D2.1 exists to fix.
