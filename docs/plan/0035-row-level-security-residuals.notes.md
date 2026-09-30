# D35 — Row-level security, residuals: build notes

The per-step build record of [D35](0035-row-level-security-residuals.md) — what was built, the amendments, the review findings and their fates, the gate's output, and what is pending the operator — kept apart from the executable plan so a builder opens the plan and not the journal ([ADR-0068](../adr/0068-behaviour-specs-and-plan-notes.md) §2, the plan apart from its notes). `/step` appends here; `/ship` and the close-out read it.

## D35.1 — Accept ADR-0083; the staff segment scoped by its route (2026-09-30)

**Accepted at the head.** [ADR-0083](../adr/0083-row-level-security-without-widenings.md) `accepted`; [ADR-0078](../adr/0078-backend-closing-wave.md) moved to `superseded by` 0083 (delta) with a note naming what moves at `D35.1`, `D35.2` and `D35.3`. The index rows for both, the topic table's "Organizations and tenancy" row (now `0067 as carried by 0078 as carried by 0083`), and the ledger's window paragraph say so. The API digest's "Row-level security" line cites 0083 first and states the staff scope; `pnpm rules:digest` regenerated `api-and-data.md` and `process.md` (the latter only re-renders 0078's citation as carried by 0083).

**Built.**

- `RequestContext.routeOrganizationId` (`core/context/request-context.ts`): the organization a staff route names, `null` otherwise. It is not a membership, so it is a field of its own rather than `ctx.organization`, which only `requireMembership` writes.
- `placeRouteOrganization` (`modules/organizations/organizations.middleware.ts`), mounted once as `router.use("/:id", …)` in `createOrganizationsRouter`. It parses the id with `idSchema`, places it when valid, and otherwise places nothing and lets the route's `validate` answer as before (a non-uuid never reaches the `::uuid` cast in the policies).
- `tenantScopeOf` (`core/db/tenant-scope.ts`): a staff principal maps to `{ organizationId: ctx.routeOrganizationId }` and nothing else, with no widening and no user id. `TenantUnscopedReason` in `@repo/db` narrowed to `"system"`. The setting, the `_unscoped` policies and the `system` placement go at `D35.2` as planned.
- `createForOwner` (`POST /admin/organizations`, not under `/:id`) calls `memberships.enterOrganization` on the new organization before writing the owner's membership, as `createTeam` does.
- `docs/specs/organizations.md`: the RLS requirement states the staff scope, the cascade and the concurrency rule, cites 0083, and gains two scenarios ("A staff request reads the table unscoped", "Two requests at once").

**Tests.**

- `organizations.int.test.ts`, in "row-level security under the repositories", replacing "lets the staff segment read every tenant, by the setting that names it":
  - "a staff read of one organization's members sees no other organization's": at the transaction level, then on the wire through the real guard;
  - "a staff request that names no organization reads no membership": memberships and invitations;
  - "staff create an organization with its owner";
  - "a staff deletion of a user removes their memberships by cascade";
  - "two concurrent requests in different organizations each see only their own": two `runWithContext` requests meet at a barrier before their transactions open and again inside them, then eight interleaved `GET /user/orgs/:orgId/members` over HTTP.
- `tenant-scope.test.ts`: "a staff principal places only its route's organization" replaces "names the staff segment's widening".
- The guard is load-bearing. With the `router.use` line commented out, four cases went red: the staff read case, and in `organizations-admin.int.test.ts` create, add/change/remove member, and last-owner refusal.

**Finding, amended in place.** The done-when's "a staff deletion of a user removes their memberships by cascade" names no path that exists:

- `DELETE /admin/users/:id` soft-deletes (ADR-0028).
- A closed account keeps its team memberships (ADR-0067 §2).
- `organizations.created_by` (`ON DELETE no action`) would refuse a hard delete of any account that created an organization, its personal one included.

The case therefore holds the ADR's actual claim at the database. The application role, inside a staff request's transaction that places nothing, hard-deletes an account (inserted by the owner, with no organization of its own) that holds memberships in two organizations, and both memberships go with it. So referential actions do bypass row-level security. ADR-0083 §2's cascade bullet is **amended 2026-09-30 (D35.1)** to say this. The case stays in the file the plan names.

**Gate** (Postgres restarted once before starting: it was down at session start, "Removed stale pid file"):

- `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check`: exit 0.
- `@repo/db`: 107 unit, 121 int.
- `api`: 825 unit, 842 int.
- "All matched files use Prettier code style!"

**Review.** The builder had no Agent tool, so it did its own pass against `.claude/agents/security-reviewer.md`. What it checked:

- The guard sits behind `authenticate("staff")` and `authorize` at the mount, and `tenantScopeOf` reads `routeOrganizationId` only for a staff principal.
- A malformed id places nothing.
- The scope narrows rather than widens: staff writes now reach only the route's organization.
- Parameterised `set_config` is unchanged, and nothing new lands in logs or responses.

No findings. The independent pass the plan's constraint requires is below.

**Residual, routed to `D35.2`.** Migration `0019`'s `_unscoped` policies still admit `app.tenant_unscoped = 'staff'` if something places it (an injected statement, ADR-0083 §7). Nothing in the API does any more. The policies are dropped at `D35.2`.

**Pending operator acceptance:** none for this step (no UI). The walk in the definition of done, item 6 (admin organization detail, members, add/remove member, create with owner), exercises the guard on the dev stack at close-out.

**Independent `security-reviewer` pass (2026-09-30).** The orchestrating session ran the `security-reviewer` agent over `9f3077a`. It found **no Critical, High or Medium findings**, and re-ran four integration files, which passed 164/164.

It confirmed five things:

- The guard places an organization only under `/admin/organizations/:id`, where every `:id` is an organization, and only behind `authenticate("staff")` and `authorize`.
- No user or impersonated request reaches `routeOrganizationId`.
- No staff path now reads empty: the organization's detail, list, update and delete touch only `organizations`, and the member routes act on the route's id.
- Staff creation and deletion of users touch only `organizations`.
- Referential actions bypass row-level security.

It logged three Lows, **not fixed**, and routed them to `D35.2`, where they fit:

1. **The concurrency case exercises the user path only.** Its first barrier is the one that proves storage isolation. The second proves only that the two transactions run concurrently. The fix: make one context a staff principal with a route organization, and name the first barrier in the comment.
2. **`router.use("/:id", placeRouteOrganization)` covers only routes registered after it.** A tenant-touching route added above it would read nothing. That fails closed. The fix is a comment saying such routes go below the guard, or a test.
3. **`routeOrganizationId` stays on the context after the router finishes.** It has no effect today.

**Residual for the record, to `D35.4`:** a future staff surface over tenant rows outside `/admin/organizations/:id` must name its organization or take a record of its own, never a widening. ADR-0083 should say so in one sentence.

**Merged to `main` (2026-09-30).**

## D35.2 — No setting widens anything; the consume policies check the row they leave (2026-09-30)

**Built.**

- **Schema and migration.** `src/schema/organizations.ts` loses both `_unscoped` policies. `organization_invitations_invitee_consume` gains `withCheck` "(admitted by the invitee) and `revoked_at is null`", and `_bearer_consume` gains "(admitted by the token hash) and `revoked_at is null and declined_at is null`". `drizzle-kit generate` wrote `0021_row_level_security_without_widenings.sql` (renamed from the generated tag, journal updated before commit): two `DROP POLICY … CASCADE` and two `ALTER POLICY … USING (…) WITH CHECK (…)`, which is what was intended. The only edit is the header comment, with the ADR-0060 §5 lock note (catalogue changes, no rows read) and the deploy order (code first, then this file).
- **The widening removed.** `TENANT_SETTINGS.unscoped`, `TenantUnscopedReason`, `TenantScope.unscoped` and `CreateDbOptions.tenantUnscoped` are gone from `@repo/db`. `replaceTenantScope` now clears three settings, not four.
- **Seeders.** `runSeeders` places no setting. The CLI already connected as the owner. The API harness's `seed`/`resetAndSeed` now seed on a short-lived owner connection, and the `db` option went with it (43 call sites).
- **Harness.** `asTooling` is removed. Every cross-tenant fixture or assertion goes through `asOwner`, as ADR-0083 §1 and its Consequences name it. The plan's "`asTooling` becomes the owner's connection" is met by the one helper, not by two names for the same connection.
  - `@repo/db`'s `migrateFreshTestDatabase` returns an owner pool.
  - A new `openApplicationRole()` serves the cases whose subject is the application role: the audit log's grants, the journal's invisibility and the 0019 policy cases.
- **Repository tests.** `organizations-repositories.int.test.ts` builds its repositories with an opener that places a tenant's scope through `replaceTenantScope`. It uses `inOrganization(id)` for tenant reads and writes and `asPrincipal(userId)` for the guard's `resolveFor` and `listForUser`. It never uses `asTooling`. The orphaned-invitation read runs in the deleted organization's own scope, and only the file's `afterAll` clean-up, which spans organizations, uses `asOwner`.
- **Generator.** The `api-module` template's organization-scoped branch emits only the tenant policy.
- **The digest's "Row-level security" line** (`scripts/rules-digest.mjs`) now says no setting widens, states the consume checks, and names the owner's connection and `asOwner`. Regenerated.
- **Spec.** In `docs/specs/organizations.md`, the requirement drops the `system` widening and states the consume rule. The session-scope scenario now uses another organization's setting. Two scenarios were added: "An invitee revokes an invitation" and "A bearer declines or revokes by token".
- **`.claude/skills/local-dev/SKILL.md`**: one troubleshooting row named `harness.asTooling`, which no longer exists, and now names `harness.asOwner`. The wider sweep of skills, agents and rules is `D35.4`'s.

**Tests.**

- `enumerations.test.ts` "no tenant-owned table carries a widening policy" is green. A policy widens when its admitting expression reads none of the three settings, or when any of its expressions reads a setting outside them. The case carries its own negative: a synthetic table with the restored `_unscoped` branch and a bare `true`, each reported by name. It was also **red with one restored**: re-adding `organization_memberships_unscoped` to the schema failed it, naming that policy, and the schema was then put back.
- `schema.int.test.ts` "the application role holds no table-wide UPDATE on organization_invitations" is green. It checks `has_table_privilege` false, the admitting columns false and the four stamps true.
- `organizations.int.test.ts`:
  - "an invitee cannot revoke an invitation addressed to them" is green: `42501`, the row is unchanged, and the invitee's decline still answers `204`.
  - "a bearer cannot decline or revoke by token" is green. The token hash is placed and no principal. Decline and revoke each give `42501`; accept stamps one row, then everything is rolled back.
  - "a session-level scope does not reach a request transaction" was rewritten. The `tenantUnscoped` pool option is gone, so the session value is now a session-level `set_config('app.organization_id', …, false)` on a one-connection pool, and a member's request in another organization reads only its own.
- `organizations-repositories.int.test.ts` is green under a tenant's scope, with no `asTooling`.
- `seed-runner.test.ts`: "places no tenant setting" replaces "places the tooling's named tenant scope".
- `tenant-scope.test.ts`: the opener writes three settings.

**Routed from D35.1's independent review.**

1. **Fixed.** The concurrency case now runs one member's context, placed by `requireMembership`, and one staff principal with `routeOrganizationId`, placed by `placeRouteOrganization`. Its comment says the first barrier proves isolation, because the scope is read in a continuation the other request released, and that the second proves only concurrency.
2. **Fixed.** `organizations.routes.ts` now carries a comment at `router.use("/:id", placeRouteOrganization)`: a route touching a tenant-owned table goes below it, a route above it fails closed, and only the two `organizations`-only routes belong above.
3. **No change, as routed.** `routeOrganizationId` lingering on the context.

**Amended in place.** ADR-0083 §3, **amended 2026-09-30 (D35.2)**. Each `WITH CHECK` is the policy's admitting expression **and** the stamp condition, not the stamp condition alone. A `WITH CHECK` replaces the `USING` an update policy would otherwise reuse as its check, so the bare condition would have stopped requiring the stamped row to be one the branch admits. That is harmless only because of `0020`'s column grant, and the conjunction does not depend on it.

**Database.** `pnpm db:migrate` against the dev database printed "applied 1, up to date", then "up to date". `pnpm db:seed -- --dev` twice gave identical output apart from turbo's timing lines.

**Gate:** `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` exited 0.

- `@repo/db`: 108 unit, 122 int.
- `api`: 825 unit, 844 int.
- "All matched files use Prettier code style!"

**Review.** The builder had no Agent tool, so it did its own pass against `.claude/agents/security-reviewer.md`. What it checked:

- Every `set_config` stays parameterised, including the test's session-level one.
- No API path placed `staff` or `system` after `D35.1`, so dropping the policies removes no access the API used. The full integration tier is green.
- Every consume the API issues still passes its check:
  - accept and decline are stamped by `pendingAt`, so `revoked_at` is null;
  - the bearer's accept-by-token stamps `accepted_at` alone;
  - `enterOrganization` runs after the consume, so no tenant scope is ORed into the consume's check;
  - an organization's revoke goes through the tenant policy, which is unchanged.
- Seeding on the owner's connection matches `pnpm db:seed` in production.
- Nothing new reaches a log or a response.

No Critical, High or Medium findings. **One Low, not fixed, logged for the record.** The consume checks forbid only the stamp the branch never writes. At the database level an invitee could still stamp `accepted_at` on an invitation they had declined, or one that had expired, and a bearer an expired one. The repository's `pendingAt` predicate refuses both, and a membership still needs its organization placed. Row-level security here defends against a forgotten predicate (ADR-0083 §7), and tightening the checks to "pending" goes beyond what §3 decided. **An independent `security-reviewer` pass is still owed.** The plan's constraint requires it before the step merges, and the orchestrating session runs it.

**Pending operator acceptance:** none for this step (no UI). The walk in definition-of-done item 6 exercises the invitation accept and decline on the dev stack at close-out.

**Independent `security-reviewer` pass over `413998c` (2026-09-30).** It found **no Critical, High or Medium findings**. It confirmed:

- `ALTER POLICY … WITH CHECK` replaces the check that would otherwise come from `USING`, so the `D35.2` amendment's conjunction is necessary and correct.
- `CASCADE` on `DROP POLICY` is inert.
- Nothing reads or places `app.tenant_unscoped` any more, and no production path lost a widening it needed.
- The owner helpers cannot reach a production bundle.
- The policy cases run as the application role.

Three Lows, **routed to `D35.3`**:

1. **The consume policies' `USING` does not require the row to be unended, which sharpens the builder's own Low.** Migration `0020` grants UPDATE on all three stamps, so a bearer's or an invitee's transaction could run `SET revoked_at = NULL, accepted_at = now()` on a revoked invitation. An invitee could also stamp `accepted_at` on one it declined, and nothing stops two stamps at once. The repository's `pendingAt` refuses all of this in the application. In the database it is un-revoking, against ADR-0083 §3's intent. The fix:
   - add `accepted_at is null and declined_at is null and revoked_at is null` to both consume policies' `USING`, which does not affect reads;
   - optionally add `expires_at > now()`;
   - add a `num_nonnulls(accepted_at, declined_at, revoked_at) <= 1` check constraint.
2. **The widening detector is syntactic and reads only the declared schema.** A hand-written policy, or `… OR true`, passes it. The fix: `schema.int.test.ts` asserts that the tenant-owned tables' `pg_policies` equal the declared set.
3. **The invitee-revoke case lacks an in-transaction positive control.** The fix: a rolled-back `declinedAt` update in the same case, asserted to succeed.

**Merged to `main` (2026-09-30).**

## D35.3 — The login role, the schema's bypasses, the committed password (2026-09-30)

**Built.**

- **The fifth reason.** `readRoleRowLevelSecurity` also reads `session_user` (`loginRole`). `rowLevelSecurityBypasses` refuses when it differs from `current_user`: `was switched to from the login role "…", one SET ROLE NONE away`. The sentence names roles only, never a credential or host.
- **The committed password.** `apps/api/src/core/config/database-password.ts` (new, self-contained, to keep D32's edits of `schema.ts` clear of this one) lists `KNOWN_PUBLIC_DATABASE_PASSWORDS`: `machxi`, `machxi_app`, `machxi_owner` and `password`. The config schema gains one `refine`: in production, a `DATABASE_URL` whose decoded password is listed is refused on `DATABASE_URL`, and the message never echoes the value. It sits in its own file because `schema.ts` would otherwise have crossed the thousand-line hygiene limit (`scripts/docs-hygiene.test.mjs`). `config.test.ts`'s `validEnv` now carries an uncommitted password, so every other production guard still fails for its own reason. ADR-0004 was not moved.
- **Schema tests** (`packages/db/src/__tests__/schema.int.test.ts`, new describe "ADR-0083 §3 and §4 — the schema admits no bypass"). Each case carries its own negative, created as the owner in a rolled-back transaction:
  - no view reads a tenant-owned table without `security_invoker`. The check is transitive through `pg_rewrite`/`pg_depend`, and materialized views are always refused. Red with a definer view, and with a definer view over an invoker view; an invoker view alone passes;
  - no `SECURITY DEFINER` function exists outside the system schemas. Red with one;
  - the tenant-owned tables' `pg_policies` equal the declared `pgPolicy` set by name, command and permissiveness. Red with a hand-written policy;
  - an invitation carries at most one terminal stamp: the constraint is validated, and a second stamp gives `23514`.
- **`docs/deploy.md`** states the three rules: connect as the role itself, not through a switch; the application role's own password; no definer views or functions. It also says the check runs once at boot, so a grant made later is caught at the next restart. The "running the reference stack locally" section now says the local roles' passwords are refused under the images' `NODE_ENV=production`.
- **Spec** `docs/specs/organizations.md`: the requirement is extended, and four scenarios were added (un-revoke, two stamps, a schema bypass, a committed database password). The role scenario names the switch, and `config.test.ts` joins its Proved by.
- **Digest.** The row-level security line (`scripts/rules-digest.mjs`) was updated and regenerated.

**Routed from D35.2's independent review.**

1. **Fixed.**
   - Both consume policies' `USING` now also requires `accepted_at`, `declined_at` and `revoked_at` all null, and the check constraint `organization_invitations_one_terminal_stamp` (`num_nonnulls(…) <= 1`) was added.
   - Migration `0022_invitation_ends_once.sql` was generated by drizzle-kit. The only edits are the header (lock note) and `NOT VALID` on the constraint.
   - `0023_invitation_ends_once_validate.sql` is a second-lane (`-- migrate:concurrently`) custom file. It holds a `DO` block that names an offending row, then `VALIDATE CONSTRAINT` under `SHARE UPDATE EXCLUSIVE`. Both statements are repeatable.
   - **The constraint is safe.** The only write of a stamp anywhere (`invitations.repository.ts` `consume`) sets one stamp under `pendingAt`, which requires all three null. Re-inviting after a decline or a revoke inserts a new row with no stamps. The dev seeder (`103-dev-organizations.ts`) writes pending invitations only. No test writes two stamps.
   - **`expires_at > now()` was declined:** `pendingAt` reads expiry against the application's clock (`at`), and `now()` in a policy would be a second clock that disagrees at the edges.
   - ADR-0083 §3 was **amended 2026-09-30 (D35.3)**.
   - Tests: `organizations.int.test.ts` "a bearer cannot un-revoke an invitation" and "an invitee cannot un-revoke an invitation addressed to them". The second also covers accepting a declined invitation. Both were verified red with `0022`'s `ALTER POLICY` lines removed.
2. **Fixed.** `schema.int.test.ts` "the tenant-owned tables hold exactly the policies the schema declares".
3. **Fixed.** "an invitee cannot revoke an invitation addressed to them" now runs the revoke and a decline in the same helper, each rolled back: `42501`, then `stamped:1`.

**Amended in place.** ADR-0083 §3 (above) and §4 (views count transitively, materialized views are refused outright, and the policy set is held by the same test), each labelled D35.3.

**Red checks.** `database-role.int.test.ts` "refuses a connection whose session user is not its current user" was red with the fifth reason disabled. So were the two older throwaway-role cases: they `SET LOCAL ROLE` from the superuser, so they now expect the switch reason as well, and the file header says why.

**Database.** `pnpm db:migrate` on the dev database printed "applied 2, up to date", then "up to date".
**Gate:** `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` exited 0.

- `@repo/db`: 108 unit, 126 int.
- `api`: 831 unit, 847 int.
- "All matched files use Prettier code style!"

**Review.** The builder had no Agent tool, so it did its own pass against `.claude/agents/security-reviewer.md`. What it checked:

- The refusal's message names `DATABASE_URL` and never the value; a test asserts both.
- The password is decoded before comparison, so a percent-encoded committed value is still refused. A malformed escape falls back to the raw value rather than throwing.
- The boot sentence names roles only.
- The schema tests' SQL is constant.
- The `USING` change leaves reads, the tenant policy and every consume the API issues unchanged: `consume` runs under `pendingAt`, so its row is unended.
- `0022` and `0023` apply in either deploy order.

No Critical, High or Medium findings. **Two Lows, not fixed, logged for the record:**

1. The refusal reaches `DATABASE_URL` only, as ADR-0083 §5 decides. `DATABASE_URL_OWNER`, which the `migrate` tooling reads, is not checked against the list.
2. The committed list is an exact match. A password with no `DATABASE_URL` or `POSTGRES_PASSWORD` line in the three env files or in `00-roles.sql` is not enumerated, and `committed-secrets.test.ts` checks only those places.

**An independent `security-reviewer` pass is still owed.** The plan's constraint requires it before the step merges, and the orchestrating session runs it.

**Pending operator acceptance:** none for this step (no UI).
