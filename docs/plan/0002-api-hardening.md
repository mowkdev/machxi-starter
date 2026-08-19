# D2 — API hardening and D3 prerequisites

- Status: **shipped 2026-08-19**, opened 2026-08-18
- Steps: `D2.1` – `D2.6`
- Ledger: [`docs/plan/README.md`](README.md)

Scope: close the gaps a technical review of D1 found, and make the decisions the frontend apps cannot start without. No new product surface beyond what the ADRs below decide; every step exists because something is either wrong, missing, or undecided.

Each step names the ADRs that govern it. Read them before implementing — they carry the reasoning, this file carries the work. Every step ends green on `pnpm lint && pnpm check-types && pnpm test` and a conventional commit.

**Amendment window — now shut.** ADRs 0025–0029 were written for this deliverable and were amendable in place while it ran, labelled `**Amended YYYY-MM-DD (D2.N).**` at the point of change ([ADR-0025](../adr/0025-deliverables.md) rule 2). D2 shipped 2026-08-19, so they are closed: change them with a superseding ADR. ADRs 0001–0024 belong to D1 and are closed: if the work below needs one of them to say something different, stop and write a superseding ADR ([ADR-0024](../adr/0024-adr-lifecycle.md) rule 1).

## Build order

### 1. ~~Task graph, caching and serialisation~~ — **done 2026-08-18**

**ADRs:** [0026](../adr/0026-task-graph-caching-and-serialisation.md), [0021](../adr/0021-testing-strategy.md) §Runner, [0004](../adr/0004-configuration-and-environment.md) §Turbo, [0002](../adr/0002-monorepo-layout-and-tooling.md) §Toolchain versions

**Closed.** `turbo.json` (`globalEnv: ["NODE_ENV"]`; `test` and `test:int` both `cache: false` with `env: ["DATABASE_URL", "DATABASE_URL_TEST"]`), the root `test` script, and `@repo/db`'s `test` script. `apps/api/turbo.json`'s `test:int` `env` was removed as redundant once the root declares it — recorded in ADR-0026 §Consequences, amended D2.1, along with the measured serial cost.

The failure mode is gone and was verified by reproducing it in both directions: with Postgres stopped, `pnpm test` now exits `1`, and the suite that fails first is `@repo/db:test` — the one this step pulled back into `test`. Before the step, that suite was unit-only and `api:test` was served from cache, so a warm cache made the whole gate green with no database at all.

**Found while checking the diff against ADR-0026's task table:** the `db:*` tasks declared no `env` at all, and turbo runs in strict env mode. `DATABASE_URL=… pnpm db:migrate` therefore silently migrated the database in `.env` instead of the one the operator named — the variable was stripped before the task saw it, and the run reported success. All seven `db:*` tasks now declare `["DATABASE_URL", "ARGON2_*", "SEED_SUPER_ADMIN_*"]`, matching what `packages/db/src/tooling/env.ts` reads. ADR-0026 §Consequences is amended with the finding and with the general form of it: under strict env mode an undeclared variable defaults quietly rather than failing loudly, which makes "declare what you read" a correctness rule for uncached tasks too, not only a hashing rule for cached ones.

First, because it is the step that makes every later step's green mean something. `apps/api`'s `test` script runs unit **and** integration (ADR-0021 §Runner), and `turbo.json` marks `test` cacheable with no `env`, so the gate replays a cached pass for a suite that never opened a database connection. Verified on 2026-08-18: `pnpm test` reported `Cached: 6 cached, 8 total` with `api:test` among them.

- `turbo.json` — `test` gets `"cache": false` and `"env": ["DATABASE_URL", "DATABASE_URL_TEST"]`; `test:int` gets the same `env` at root (today only `apps/api/turbo.json` declares it); `test:unit` stays cacheable and gains nothing. Add `"globalEnv": ["NODE_ENV"]`, which is the minimum ADR-0004 §Turbo has been owed since `core/config` landed in D1.7 — declare more only for a variable something actually reads.
- `package.json` (root) — `"test": "turbo run test --concurrency=1"`, for the reason ADR-0021's D1.8 amendment gives for `test:int`: both `@repo/db` and `api` rebuild `DATABASE_URL_TEST` in `globalSetup`, and in parallel one drops the schema while the other is mid-run.
- `packages/db/package.json` — `"test": "vitest run && vitest run --config vitest.int.config.ts"`. It has three integration files behind `test:int` and excludes them from `test`, which is not what ADR-0021 §Runner defines `test` to be. This is why the race above is currently unreachable, and why it becomes reachable the moment this line is fixed — hence the `--concurrency=1` in the same step.

**Done when:** `pnpm test` run twice in a row reports no cache hit for any `test` task both times; `pnpm test:unit` run twice does hit cache the second time; `pnpm test` is green with Postgres up and fails (rather than passing from cache) with Postgres down.

### 2. ~~Conformance and hygiene fixes~~ — **done 2026-08-19**

**ADRs:** [0020](../adr/0020-security-baseline.md) §CORS, [0002](../adr/0002-monorepo-layout-and-tooling.md)

**Closed.** `apps/api/src/app.ts` gains an exported `corsOrigin(origins)` that maps a list containing `"*"` to `cors`'s `origin: true`; `.gitignore` covers `apps/web/next-env.d.ts`, which is untracked; `packages/ui/eslint.config.mjs` is renamed `.js`. `apps/api/test/cors.int.test.ts` — 7 tests through the real `createApp`, using the config-override seam in `test/support/app.ts`.

Two things worth keeping from the doing of it:

- **The fix is reflection, not a literal `*`,** and that corrected an ADR. `origin: true` makes `cors` echo the request's `Origin` back, which is what lets a wildcard coexist with `credentials: true` — a literal `*` on a credentialed response is refused by browsers. ADR-0029 §Consequences had asserted the opposite ("a wildcard origin now fails in the browser… `*` is unusable anywhere"), which was wrong about this implementation and is **amended 2026-08-19 (D2.2)**. The corrected reading matters: reflecting any origin on an API that will set a credential cookie is as open as it sounds, and the only thing preventing it is ADR-0004's production refusal of `*` — a guard this makes more load-bearing, not less.
- **One assertion was written badly and rewritten.** `expect(header).not.toBe("*")` passes against an absent header, which is precisely the bug under test. Verified by stashing the fix and re-running: 2 of 7 fail against the old code with `expected undefined to be 'http://localhost:3001'`, and the weak assertion was changed to an equality so it fails too.

Three small divergences, none of which needed a decision — the decisions existed and the code did not match them.

- **`CORS_ORIGINS=*` silently blocks every origin.** `apps/api/src/core/config/schema.ts` accepts `z.literal("*")` as an allow-list entry and a `.refine` rejects it only when `NODE_ENV=production`, which is ADR-0020 §CORS ("No `*` in production") implemented faithfully. But `apps/api/src/app.ts` passes the array straight to `cors({ origin: [...] })`, and `cors` does exact-string matching on array entries, so `"*"` matches no `Origin` header ever: setting it produces the exact opposite of intent, with no error. Map a list containing `"*"` to `origin: true` before handing it to `cors`. Cover it with a test that asserts `Access-Control-Allow-Origin` for a wildcard config, an allow-listed origin, and an empty list.
- **`apps/web/next-env.d.ts` is committed and rewritten by `check-types`.** `web`'s `check-types` runs `next typegen`, which rewrites the file (`.next/types` → `.next/dev/types` depending on which build ran last), so the documented gate dirties the working tree on every run — it is dirty in the repository right now. Add it to `.gitignore` and `git rm --cached` it. `.next` is already ignored.
- **`packages/ui/eslint.config.mjs` is the only one of its kind.** Every other package uses `eslint.config.js`, and the package is `"type": "module"`, so the extension buys nothing. Rename it.

**Done when:** the three CORS cases are asserted by tests; `pnpm check-types` twice in a row leaves `git status` clean; no `eslint.config.mjs` remains.

### 3. ~~Credential self-service and administrative password reset~~ — **done 2026-08-19**

**ADRs:** [0027](../adr/0027-credential-self-service-and-reset.md), [0017](../adr/0017-identity-model-populations-and-roles.md) §Invariants, [0018](../adr/0018-authentication-sessions-and-tokens.md) §Staff onboarding, [0019](../adr/0019-authorization-guards.md), [0023](../adr/0023-shared-contracts-package.md)

**Closed.** The four endpoints exist and the two populations are symmetric about credentials: `GET|PATCH /api/v1/admin/profile` and `POST /api/v1/admin/profile/change-password` behind `authenticate("staff")` with no `authorize`, and `POST /api/v1/admin/{staff,users}/:id/password` behind `authorize("admin")`. `apps/api/test/staff-profile.int.test.ts` is new (23 tests); the two admin files gained the reset endpoints and their guard-matrix rows. 402 unit and 303 integration tests, and 77 Postman requests green on two consecutive runs.

Three things the step decided that the plan above left open, all recorded in ADR-0027, **amended 2026-08-19 (D2.3)**:

- **`POST /admin/users/:id/password` has a staff actor and a user subject.** `usersService` is bound to the `user` population, so it cannot verify the caller's own password — the caller is not one of its accounts. `staffService` exposes `verifyActorPassword`, the function its own reset already uses, and `usersService` takes it as `actors` from the container. That is the first cross-module service dependency in `core/container.ts`, and it is the direction ADR-0009 allows: through a service, never a repository.
- **The error factory follows the code out of the users module.** The plan said "a renamed error factory" per module; a copy in each would have reproduced, in the error layer, the exact asymmetry ADR-0027 exists to remove. `currentPasswordInvalid` is declared once in `modules/auth/auth.errors.ts` — the same reasoning that made the code `AUTH_`-prefixed.
- **`updateStaffProfileBody` was missing from the contracts list.** `PATCH /admin/profile` is "names only" and no such body existed; `updateStaffBody` carries the two fields it must not have. Not nullable, unlike the user profile's: the `staff` columns are `NOT NULL`. This is what makes the unguarded router safe — an `editor` sending `roles` is refused as an unknown key, so the escalation fails on the schema rather than on a rule somebody has to remember.

One ordering choice worth keeping: **the actor is verified before the subject is read.** ADR-0027 rule 1 fixes that the actor re-presents their password, not when. First means a wrong actor password answers the same `403` whether or not the id exists — so a caller who cannot use the endpoint cannot use it to enumerate accounts either — and a refused request buys no argon2 hash of a new password it is about to discard.

The rank rule was checked rather than assumed: with `assertMayActOnSuperAdmin` removed from `setPassword`, "refuses an admin who aims it at a super admin" fails, and it fails loudly — the reset lands, the super admin's sessions die, and three later tests fall over with it.

**What the two reviews changed.** `adr-reviewer` found no divergence from any ADR — including the three calls above, two of which it read as more correct than this plan's prose — and one factually wrong comment in `core/container.ts`, since fixed. `security-reviewer` produced three changes and one thing this step deliberately did not do:

- **The rank decision was taken outside the transaction that writes the hash.** `update` takes `lockRoleInvariant` and reads inside its transaction precisely so the invariant is decided against the snapshot the write shares; the reset did not, so a target promoted to `super_admin` between the read and the commit had its credential rewritten by a plain `admin`. It now checks twice — cheaply outside so a refusal costs no argon2 hash, and again inside the transaction after the lock. ADR-0027 §Consequences, amended, carries the general form.
- **A missing actor row answered `404 NOT_FOUND` with "Staff member not found"** — from `POST /api/v1/admin/users/:id/password`, where that message describes the wrong account entirely. `verifyActorPassword` now answers the same `403` a wrong password does: the caller cannot prove anything either way. Unreachable until D2.4 can delete a staff account.
- **The router comment claiming "nothing here is brute-forceable" was true of `change-password` and false of the resets,** which is the finding rather than the comment: on `/:id/password` the caller presents a password they may not know, so the `403` is a guessing oracle against the credential ADR-0027 rule 1 leans on, bounded only by the global `300 / 15 min / IP`.
- **No fifth limiter was built, and that is not a deferral by preference.** ADR-0027 §Consequences already refused to half-close the missing per-principal budget, and rate limiting belongs to ADR-0020 — D1, frozen — so building one here would mean diverging from a shipped ADR instead of superseding it (ADR-0024 rule 1). The ADR is amended with the corrected reasoning so that whoever writes that ADR knows it is closing a brute-force gap and not only a cost one. **This is the one thing D2.3 leaves open that somebody has to decide.**

Two findings were left alone on purpose: a reset writes a credential onto a soft-deleted user (D2.4 refuses it with `USER_DELETED`, so it is scheduled rather than missed), and a login already in flight can straddle a reset's revocation — closing that needs a `password_changed_at` column compared against `sessions.created_at`, which is a schema decision.

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

### 4. ~~Account deletion~~ — **done 2026-08-19**

**ADRs:** [0028](../adr/0028-account-deletion.md), [0006](../adr/0006-database-postgres-drizzle.md), [0008](../adr/0008-database-migrations-and-seeding.md), [0017](../adr/0017-identity-model-populations-and-roles.md)

**Closed.** Migration `0002_users_email_partial_unique` replaces the unqualified unique constraint on `users.email` with `unique (email) where deleted_at is null`; `DELETE /api/v1/admin/users/:id` soft-deletes in one transaction and `DELETE /api/v1/admin/staff/:id` hard-deletes behind four rules; `USER_DELETED` (409) joins the error union. `apps/api/test/staff-delete.int.test.ts` is new, both guard matrices gained the route, and `@repo/db`'s schema suite gained four tests over the partial index. 420 unit, 332 integration, 82 Postman requests — and the Postman teardown now deletes the three accounts each run creates instead of disabling them, which is what ADR-0028 §Consequences reserved.

Three things the plan above says that turned out to be wrong, all corrected in [ADR-0028](../adr/0028-account-deletion.md), **amended 2026-08-19 (D2.4)**:

- **`onConflictDoNothing` takes `where`, not `targetWhere`.** `targetWhere` is `onConflictDoUpdate`'s option; drizzle emits `where` between the target and `do nothing`, which is Postgres's index-inference position. Passing `targetWhere` would have been dropped silently and a duplicate registration would have answered `500` — the exact failure the ADR wrote the sentence to prevent.
- **The repository is not "the one place" the change is load-bearing.** `packages/db/seeds/dev/102-dev-users.ts` names the same constraint and broke first: with the index partial and the target bare, Postgres refuses the statement outright, so every integration file failed in `beforeAll` before an endpoint ran. Anything that upserts on `users.email` carries the predicate — and the second offender was outside `src/`, where a search for the endpoint's code path does not reach.
- **Self-deletion is refused before the invariant, not after.** "You may never do this" outranks "nobody may do this right now", which is the order `staff.update` already applies (ADR-0017, amended step 9). It also makes the last-super-admin refusal unreachable in sequence — the only caller entitled to delete the last one is themselves — so rule 2 is understood as a concurrency guard and is tested that way: two super admins deleting each other, exactly one of which lands.

**The reviews found one real bug and two races.** `adr-reviewer` and `security-reviewer` independently found the same defect:

- **The self-deletion rule was bypassable by uppercasing the id.** `z.uuid()` accepts uppercase and Postgres compares canonically, so the row lookup succeeded while `id === principal.id` did not. `idSchema` now lower-cases on the way in — the fix for the class, since the only ids this API compares are a path parameter and a JWT `sub`, and only one of them was normalised — and the rule is re-checked inside the transaction against the row's own id. The first test written for it proved nothing, because every id in the unit fixtures is all digits and `toUpperCase()` on those is a no-op; both tests now assert that premise before relying on it.
- **A `PATCH` racing a delete could write `status: 'active'` onto a deleted row**, recreating the active-and-deleted state ADR-0028 exists to prevent: the service's refusal is a check, not a lock. `updateColumns` and `updatePasswordHash` now match live rows only.
- **A login racing a delete outlives it.** `login` verifies argon2 outside any transaction and inserts its session afterwards, so a session can appear after the delete has swept — and for staff that is a deleted operator holding `admin` until the access token expires, because `authenticate` verifies the session and never the principal. Both deletes sweep once more after the commit, narrowing the window to a single statement. **Closing it needs a per-request principal check, which is a superseding ADR to ADR-0018 (D1, frozen) and is the second thing D2 leaves for somebody to decide** — the first being the per-principal rate limit D2.3 left open.

Two smaller notes worth keeping: `drizzle-kit generate` writes `meta/*.json` unformatted, so `pnpm format` belongs after `pnpm db:generate` (the 0000 and 0001 snapshots are prettier-clean and 0002 now matches them); and the _Implemented_ column in the [ADR index](../adr/README.md) was filled in ahead of time when ADR-0025–0029 were written, so it already names `D2.4` and migration `0002` correctly.

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

### 5. ~~Browser token transport~~ — **done 2026-08-19**

**ADRs:** [0029](../adr/0029-browser-token-transport.md), [0018](../adr/0018-authentication-sessions-and-tokens.md) §Token transport, [0020](../adr/0020-security-baseline.md) §CORS

**Closed.** `X-Auth-Transport: cookie` on `login`, `refresh` and `register` moves the refresh token into `__Secure-machxi.refresh` and omits it from the body; `core/middleware/csrf.ts` guards `refresh`, `logout` and `logout-all`; `AuthResource.refreshToken` and `refreshBody.refreshToken` are optional and `CSRF_TOKEN_INVALID` (403) joins the union. New files: `core/http/cookies.ts`, `core/middleware/csrf.ts`, `modules/auth/auth.cookies.ts`, `test/support/transport.ts`, `test/auth-cookie.int.test.ts`. The auth suite now runs four times — population × transport — for 446 unit and 406 integration tests. Postman is deliberately unchanged, on `body` transport, which keeps the collection an accurate description of what a mobile client does.

Two decisions the ADR did not settle, both recorded in it (**amended 2026-08-19 (D2.5)**):

- **A cookie-driven `refresh` is answered on cookie transport whether or not the header is present.** Header-only reads well and is a trap: a browser that forgets the header gets the rotated token in the body and no new cookie, so it keeps the value that was just rotated away — replaying that later is reuse detection, and the session is revoked. A missing header must not cost a session. It is not the `Origin`-sniffing the ADR rejected, and §CSRF already reasons with the same predicate: the signal is the credential the client actually presented.
- **`validate` treats an absent body as `{}`.** `fetch(url, { method: "POST" })` — what a browser refreshing from its cookie sends — carries no body and no content type, so Express leaves `req.body` undefined and every field of `refreshBody` is now optional. Every other all-optional body schema carries `.refine(keys > 0)`, so `refreshBody` is the only one whose acceptance widened.

**The security review found two HIGH defects in what shipped, and both were real.**

- **The CSRF token was unreadable by any real browser.** ADR-0029 scoped `machxi.csrf` to the same path as the refresh cookie, and `document.cookie` returns only cookies matching the _document's_ path — so an app at `/dashboard` could never read a token scoped to `/api/v1/admin/auth`. The double-submit could only ever have failed, and the first thing anyone building `admin` would have done is delete the check. It is now `__Host-machxi.csrf` at `Path=/`, **and** returned in the body as `AuthResource.csrfToken`, because an app on a different host from the API — same-site enough for the cookie to be sent, different-host enough that it cannot read it — is exactly the deployment `CORS_ORIGINS` exists for.
- **A sibling subdomain could shadow either cookie.** `__Secure-` constrains the scheme, not the host, and RFC 6265 orders the `Cookie` header so the attacker picks what a first-match reader sees: their CSRF token, or their refresh token (session fixation, winning every rotation). `readCookie` now fails closed on a duplicate name, and `__Host-` closes it outright for the CSRF cookie.

Two MEDIUMs went with them: the refresh limiter counted `403`s and `400`s, so any web page could spend a visitor's budget and — on cookie transport, with no token in JavaScript to retry with — end their session; and the body exemption in the CSRF guard applied to `logout`, which reads no body at all.

**What D2.5 leaves open**, all in ADR-0029's amended §Consequences: cookie transport requires a same-site deployment with no untrusted host under the registrable domain; a cross-host app cannot bootstrap a CSRF token after a page reload without a `GET /auth/csrf` endpoint, which is a decision rather than an implementation detail; and a refresh that fails terminally does not clear the cookie, because a controller that inspects an error before rethrowing is what ADR-0013 keeps out of controllers.

ADR-0029 was accepted on 2026-08-18, which un-gates this step. It changes `AuthResource`, a published contract, so it lands **before** any D3 client code is written and not alongside it.

Implements ADR-0029 as written: `X-Auth-Transport` opt-in; the refresh token in a `__Secure-machxi.refresh` cookie scoped per segment; a double-submit CSRF token on `refresh`, `logout` and `logout-all`; `AuthResource.refreshToken` and `refreshBody.refreshToken` become optional; `CSRF_TOKEN_INVALID` (403) joins the error codes; `logout` clears both cookies. New middleware at `apps/api/src/core/middleware/csrf.ts`.

The integration suite is already parameterised by population (ADR-0021, D1.8 amendment); transport is a second axis on the same `describe.each` case object. Postman stays on `body` transport, which keeps the collection an accurate description of what a mobile client does.

**Done when:** both transports pass the full auth suite for both populations; a cookie-transport response body contains no `refreshToken`; a cookie-driven refresh without `X-CSRF-Token` answers `403`.

### 6. ~~Close-out~~ — **done 2026-08-19**

**ADRs:** [0025](../adr/0025-deliverables.md) rule 4, [0021](../adr/0021-testing-strategy.md) §Acceptance checklist

**Closed.** The _Implemented_ column names every ADR D2 built or extended; `CLAUDE.md`, `docs/README.md` and this file's amendment note say the window is shut; the ledger row reads `shipped 2026-08-19`. `.env.example` needed no change — no step in D2 added a variable, which ADR-0029 §Contracts states as a decision rather than an accident.

**The checklist was run on a fresh clone, and all six items pass.** Worth keeping from the doing of it:

- **Item 4 failed the first time for a reason that was not the repository.** `@repo/ui:test` could not start vitest — `ERR_PACKAGE_IMPORT_NOT_DEFINED: "#module-sync-enabled"` from vite — on a clone made inside a deep temporary directory. The trees were byte-identical to the working one (same vite, same `package.json`, same `config.js` hash, same `vitest → vite` link), which left the path: at ~270 characters the file sits past Windows' 260-character `MAX_PATH`, so Node could not read `vite/package.json` and reported its `imports` map as missing. The same clone at a 47-character path passes. **A fresh-clone check on Windows has to be done somewhere short**, and this is the note that says so.
- **Item 6 works, and the failure it produces is the one D2.1 designed.** With Postgres stopped, `pnpm test` exits non-zero and `@repo/db:test` is the suite that fails first — the one D2.1 pulled back into `test`. Before that step a warm cache made the whole gate green with no database at all.
- **Item 3 is the D2.2 fix, observed rather than asserted.** `pnpm lint && pnpm check-types` on a fresh clone leaves `git status` clean; before D2.2, `next typegen` rewrote a committed file on every run.

**Three decisions D2 deferred now have an owner** in the ADR index's _Planned_ list, written before the window shut so they cannot be lost: a per-principal budget for expensive routes (a brute-force gap, not only a cost one, per D2.3's review), per-request principal freshness (`authenticate` verifies the session and never the principal), and `GET /auth/csrf`, the endpoint that would lift ADR-0029's same-host constraint. Each names the ADR it would supersede.

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
