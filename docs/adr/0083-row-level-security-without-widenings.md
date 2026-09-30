# ADR-0083: Row-level security without widenings — staff scoped by the route, tooling as the owner (supersedes ADR-0078 in part — a delta)

- Status: accepted
- Date: 2026-09-30
- Supersedes (at the step that makes each delta true): [ADR-0078](0078-backend-closing-wave.md) (delta: §4's named widenings — `staff` and `system` — are removed, the staff segment is scoped by its route's organization, the consume policies gain a check on the row they leave, the boot refusal reads the login role as well, and §2's rule that a committed value is refused in production reaches the database password)

> Written 2026-09-30 by `/scope` for D35 ([`docs/plan/0035-row-level-security-residuals.md`](../plan/0035-row-level-security-residuals.md)), the day D29 shipped, with D32 in progress, on the four decisions the operator took at scoping — writing is not opening, opening is not accepting. `proposed` at writing; **accepted 2026-09-30 at the head of `D35.1`**, where [ADR-0078](0078-backend-closing-wave.md) moved to `superseded by` for the delta above; §2 and §6 are built at `D35.1`, §1 and §3 at `D35.2`, §4 and §5 at `D35.3`. Amendable in place, labelled, while D35 is `in progress` (ADR-0079 §1).

## Context

ADR-0078 §4 landed row-level security on the tenant-owned tables and hardened it at `D29.7`. Its independent reviews left one design question and a handful of residuals, carried by the ledger's D35 row:

- **Two settable widenings.** `app.tenant_unscoped` admits every tenant's rows when it reads `staff` (the staff segment) or `system` (the seeders and the test tooling). A setting is placed by `set_config`, so an injected statement could place it too, and the staff segment sees every tenant at the database level whatever the route.
- **Neither widening is needed.**
  - **Staff.** Every staff read or write of memberships and invitations names one organization in its route (`/admin/organizations/:id/…`), and the cross-tenant list reads `organizations`, which carries no policy.
  - **The seeders.** They already connect as `machxi_owner`, which the policies do not bind (there is no `FORCE`), so their `system` setting does nothing.
  - **The tests.** Only the test harness's `asTooling` and `@repo/db`'s test pool rely on `system`, and both can use the owner's connection.
- **The consume policies choose rows, not outcomes.** The column grant of `0020` keeps an admitted `UPDATE` to the four stamps. An invitee's or a bearer's transaction could still set `revoked_at`, or a bearer's `declined_at`, which no route of theirs does.
- **The boot refusal reads `current_user` only.** A login role switched at connect time (`ALTER ROLE … SET role`, or `options=-c role=…`) passes while the privileged login stays one `SET ROLE NONE` away.
- **The committed `machxi_app` password passes in production.** Neither the config schema nor the boot refusal refuses it.
- **Other bypasses.** A view or a `SECURITY DEFINER` function owned by `machxi_owner` over a tenant-owned table would bypass the policies unless it is `security_invoker`. Nothing checks for one.
- **The scope is read from AsyncLocalStorage** when a transaction opens, rather than handed down from `ctx`. It is safe today, and nothing proves it.

## Decision

### 1. No setting widens anything

`app.tenant_unscoped` is removed: the setting, both `_unscoped` policies, the `TenantUnscopedReason` type and the `tenantUnscoped` pool option. Every policy on a tenant-owned table admits a row only because a setting names that row's organization, its principal, or its token's hash. **Anything that must see every tenant connects as the owner**:

- the seeders, which already do;
- the integration harness's own reads and fixtures, through `asOwner`;
- `@repo/db`'s tooling assertions.

The repository-level tests run under a tenant's scope, so they exercise the policies rather than bypass them.

### 2. The staff segment is scoped by its route

The staff segment keeps ADR-0067 §3's rule: staff are above tenants, never inside them, and hold no membership. What changes is how that reaches Postgres.

- **A route that names an organization places it.** A route under `/admin/organizations/:id` places that id as `app.organization_id` through a guard of its own — not `requireMembership`, since staff hold no membership. The request's opener places it exactly as it places a member's.
- **A staff request places no principal setting**, so a staff read that forgets its organization returns nothing, as a member's does.
- **Creating an organization** places the new organization before its owner's membership is written, as the user segment's paths already do.
- **Cascades need no setting.** A staff deletion that removes memberships by a foreign key's cascade works without one, because referential actions are not subject to row-level security. **Amended 2026-09-30 (D35.1).** No staff route removes memberships this way today: `DELETE /admin/users/:id` soft-deletes the account (ADR-0028), a closed account keeps its team memberships (ADR-0067 §2), and `organizations.created_by` would refuse a hard delete of any account that created an organization. The rule is therefore held at the database — the application role, in a staff request's transaction that places nothing, hard-deletes an account and its memberships in two organizations go with it — so a future hard-delete path inherits it.

### 3. The consume policies check the row they leave

`organization_invitations_invitee_consume` gains `WITH CHECK (revoked_at IS NULL)`: an invitee accepts or declines and never revokes. `organization_invitations_bearer_consume` gains `WITH CHECK (revoked_at IS NULL AND declined_at IS NULL)`: a bearer accepts and nothing else. The tenant policy, which the organization's own admins revoke through, is unchanged. **Amended 2026-09-30 (D35.2).** Each check is the policy's own admitting expression **and** the stamp condition, not the stamp condition alone: a `WITH CHECK` replaces the `USING` a policy would otherwise reuse as its check, so the condition alone would stop requiring the stamped row to be one the branch admits. The column grant of `0020` already keeps the admitting columns unwritable; the conjunction keeps the policy true without leaning on it.

### 4. The boot refusal reads the login role, and the schema admits no bypass

The refusal of ADR-0078 §4 as amended at `D29.7` gains a fifth reason: it refuses when `session_user` differs from `current_user`, since the login role is then one `SET ROLE NONE` away. A schema test refuses two kinds of object in any non-system schema:

- a view that reads a tenant-owned table and is not `security_invoker`;
- a `SECURITY DEFINER` function.

`docs/deploy.md` states both rules. The refusal stays a check at boot. A membership or ownership granted while the API runs is an operator's act, and deploy.md says the next restart is what catches it.

### 5. A committed database password is refused in production

ADR-0078 §2's rule is that a committed value is refused in production. It reaches `DATABASE_URL`: in production, a URL whose password is one this repository commits is refused at startup, like a committed signing secret.

### 6. The scope stays in request storage, and a test holds it there

The opener keeps reading the request context from AsyncLocalStorage. The rule is that no work queued in one request runs inside another request's continuation. An integration test holds it: two concurrent requests in different organizations each see only their own.

### 7. What row-level security is for, stated

The policies defend against a **forgotten predicate**, not against SQL injection. Any setting, `app.organization_id` included, can be placed by an injected statement. Parameterised queries are the injection defence: Drizzle's `sql` template binds every value. With §1, an injected statement reaches one organization whose id it knows, rather than every tenant. **A signed `SECURITY DEFINER` setter is declined:** it needs a key inside the database and a round trip per transaction, for a boundary the parameterised queries already hold.

## Consequences

- No setting widens anything. The staff segment's database view narrows to the organization its route names.
- A test that needs every tenant says so by using the owner's connection. `asTooling` and the `system` pool are gone.
- **A fork's new staff route over a tenant-owned table must name its organization.** The generator's organization-scoped template stops emitting the unscoped policy.
- The migration that drops the `_unscoped` policies ships in the same deploy as the code that stops placing them. The old code running against the new schema would show staff no memberships, which fails closed. The deploy order of ADR-0078 §4 applies: code first, then the migration.
- The boot refusal can refuse a deployment that switches roles at connect time. Such a deployment connects as the application role directly.

## Alternatives considered

- **A separate database role and pool for the staff segment**, with policies written `TO` it. It closes widening by injection in the user segment, but staff still see every tenant, and every deployment and fork gains a role to provision. Declined for §2.
- **Keeping `system` for the tests only.** It leaves a widening in the schema that production never uses. Declined for §1.
- **Passing `ctx` to every transaction.** The type system would then carry the scope, at the cost of a mechanical change to every service's transaction call. Declined for §6's test.
- **A signed setter.** Declined in §7.
