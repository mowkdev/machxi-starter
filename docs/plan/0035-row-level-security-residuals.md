# D35 — Row-level security, residuals

- Status: **in progress** — **scoped in full 2026-09-30 by `/scope`**, from the ledger row written at `D29.7`, the day D29 shipped (ledger §How D35 was scoped). **Opened 2026-09-30** on the operator's decision, as a lane beside D32 (ledger §How D35 opened).
- Records: [ADR-0083](../adr/0083-row-level-security-without-widenings.md) (no setting widens anything, the staff segment scoped by its route, the consume policies' check, the login role and the schema's bypasses, the committed database password, the scope held in request storage by a test). Written `proposed` at scoping and accepted at the head of `D35.1`. It supersedes in part [ADR-0078](../adr/0078-backend-closing-wave.md), which moves at `D35.1`. Amends none.
- Schema: yes
- Ledger: [`docs/plan/README.md`](README.md)
- Notes: [`0035-row-level-security-residuals.notes.md`](0035-row-level-security-residuals.notes.md)

## Goal

Row-level security on the tenant-owned tables stops depending on a setting that widens it. Staff see the organization their route names; tooling that needs every tenant connects as the owner; the policies, the boot refusal and the schema close the residuals D29's reviews logged. Nothing on the wire changes.

## Constraints

- No `drizzle-kit push`; committed migrations are never edited. The new migration drops the `_unscoped` policies and replaces the two consume policies, and ships in the same release as the code that stops placing `staff` and `system`. The deploy order stays code first, then migration (ADR-0078 §4 as carried, ADR-0008 as carried).
- The application role stays bound: no `FORCE ROW LEVEL SECURITY`, and no role or grant change beyond what ADR-0083 names (ADR-0061 §1).
- Staff hold no membership and are never resolved by `requireMembership` (ADR-0067 §3 as carried).
- A behaviour change updates `docs/specs/organizations.md` in the same diff (ADR-0068 §1).
- `security-reviewer` reads the diff of every step that changes code. If the builder cannot spawn it, the orchestrating session runs it before the step merges.
- The gate as `CLAUDE.md` §Commands defines it, at every step.

## Decisions taken at scoping (operator, 2026-09-30)

- **The staff segment is scoped by its route.** The `staff` widening and its policy branch are deleted.
- **The `system` widening is removed.** Tooling and tests that need every tenant use the owner's connection.
- **The scope stays in AsyncLocalStorage**, held there by a concurrency test.
- **Row-level security is not an injection boundary.** The ADR says so, and a signed `SECURITY DEFINER` setter is declined by name.
- **Recorded, not asked:** a committed database password is refused in production under ADR-0078 §2's rule rather than a new config record. The boot refusal stays a check at boot, documented.

## Steps

Each step: implement, gate green, one bounded diff review, commit (ADR-0050). ADRs listed are what the builder reads first.

- [ ] **1. Accept ADR-0083; the staff segment scoped by its route.** Accept 0083 at the head, where [ADR-0078](../adr/0078-backend-closing-wave.md) moves (its status line, the index rows, the topic table and the ledger's window section say so), and write its digest line. A guard on `/admin/organizations/:id` routes places the route's organization on the request context. `tenantScopeOf` places no setting for a staff principal beyond that organization. Staff creation of an organization places it before the owner's membership. The concurrency test of 0083 §6 is written.
      **ADRs:** 0083 §2 and §6, 0078 §4 as carried, 0067 §3 and §4 as carried.
      **Done when:** - `organizations.int.test.ts` cases, all green: "a staff read of one organization's members sees no other organization's", "a staff request that names no organization reads no membership", "staff create an organization with its owner" and "a staff deletion of a user removes their memberships by cascade". - An API integration case "two concurrent requests in different organizations each see only their own" is green. - `tenant-scope.test.ts` case "a staff principal places only its route's organization" is green. - `security-reviewer` has read the diff; `pnpm test --filter=api` is green; the gate is green.
- [ ] **2. No setting widens anything; the consume policies check the row they leave.** A migration drops both `_unscoped` policies and recreates the two consume policies with 0083 §3's `WITH CHECK`, declared through the `pgPolicy` entries so `drizzle-kit` generates it. `app.tenant_unscoped`, `TenantUnscopedReason` and the `tenantUnscoped` pool option are removed, and the seeders' `system` placement with them. `asTooling` becomes the owner's connection, `@repo/db`'s test pool connects as the owner, and the repository-level tests run under a tenant's scope. The `api-module` generator's template stops emitting the unscoped policy.
      **ADRs:** 0083 §1 and §3, 0078 §4 as carried, 0061 §1 and §2, 0060 §5.
      **Done when:** - `enumerations.test.ts` case "no tenant-owned table carries a widening policy" is green, and red with one restored. - `schema.int.test.ts` case "the application role holds no table-wide UPDATE on organization_invitations" is green. - `organizations.int.test.ts` cases "an invitee cannot revoke an invitation addressed to them" and "a bearer cannot decline or revoke by token" are green. - `organizations-repositories.int.test.ts` is green under a tenant's scope, with no `asTooling`. - `pnpm db:migrate` against the dev database applies the file, then reports up to date; `pnpm db:seed -- --dev` gives identical output twice. - `security-reviewer` has read the diff; the gate is green.
- [ ] **3. The login role, the schema's bypasses, the committed password.** The boot refusal gains 0083 §4's fifth reason, `session_user <> current_user`. A schema test refuses a view over a tenant-owned table that is not `security_invoker`, and any `SECURITY DEFINER` function outside the system schemas. In production, the config schema refuses a `DATABASE_URL` whose password is one this repository commits. `docs/deploy.md` states the three rules and that a grant made after boot is caught at the next restart.
      **ADRs:** 0083 §4 and §5, 0078 §2 and §4 as carried, 0004 as carried by 0075 (read only; not moved).
      **Done when:** - `role-check.test.ts` case "names a login role switched at connect time" is green. - `database-role.int.test.ts` case "refuses a connection whose session user is not its current user" is green, and red without the fifth reason. - `schema.int.test.ts` cases "no view reads a tenant-owned table without security_invoker" and "no SECURITY DEFINER function exists outside the system schemas" are green, each red with one such object created. - `config.test.ts` case "a committed database password is refused in production" is green. - `committed-secrets.test.ts` is green. - `security-reviewer` has read the diff; the gate is green.
- [ ] **4. Close-out.** The D29 notes' routed residuals and the ledger row carry their fates. `docs/specs/organizations.md` states the staff segment's scope. The skills, the agents and the rule files name the owner's connection as the only way to read every tenant. The digests are regenerated. Then the definition of done.
      **ADRs:** 0083, 0065 as carried.
      **Done when:** the definition of done below, every item.

## Definition of done

Run at `D35.4` and again by `/ship` on the committed tree.

1. The gate green, every task cold: `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check`.
2. `pnpm test:unit` twice, the second `FULL TURBO`.
3. `pnpm db:migrate` up to date against the dev database; `pnpm db:seed -- --dev` twice with identical output.
4. `pnpm test:postman` exit `0` with the counts the READMEs state.
5. `pnpm test:e2e` green in both apps against the local compose.
6. The operator's walk on the dev stack: the admin organizations list, one organization's detail and members, adding and removing a member, creating an organization with its owner; on the customer app, a member's organization screens and an invitation accept.
7. `pnpm audit --prod` reports no advisory.
8. `pnpm rules:digest` writes nothing on a second run; `pnpm docs:check` clean.

## Not in D35

A separate database role or pool for staff; passing `ctx` to every transaction; a signed `SECURITY DEFINER` setter (ADR-0083 §7); a periodic re-check of the database role; `FORCE ROW LEVEL SECURITY`; D34's work.
