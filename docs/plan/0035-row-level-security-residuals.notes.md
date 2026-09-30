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

No findings. **An independent `security-reviewer` pass over this diff is still owed**, as the plan's constraint requires, before the step merges to `main`.

**Residual, routed to `D35.2`.** Migration `0019`'s `_unscoped` policies still admit `app.tenant_unscoped = 'staff'` if something places it (an injected statement, ADR-0083 §7). Nothing in the API does any more. The policies are dropped at `D35.2`.

**Pending operator acceptance:** none for this step (no UI). The walk in the definition of done, item 6 (admin organization detail, members, add/remove member, create with owner), exercises the guard on the dev stack at close-out.
