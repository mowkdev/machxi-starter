# ADR-0067: Organizations — multi-tenancy as a first-class model

- Status: proposed
- Date: 2026-09-02

> Written 2026-09-02 by `/scope` while scoping D14, for D15 ([`docs/plan/0015-organizations.md`](../plan/0015-organizations.md)) — written early so D14's steps are built tenant-aware. `proposed` at writing; accepted at the head of the D15 step that builds it.

## Context

[ADR-0017](0017-identity-model-populations-and-roles.md) (_identity model — two populations with roles_) decides that staff and users are separate tables with separate roles and separate segments. It decides nothing about what a user's data **belongs to**, because in that model nothing owns anything: a user owns their rows and that is the whole ownership graph. There is no tenant concept anywhere in the repository.

Retrofitting one is not a feature; it is a rewrite. It adds a column to every business table, a parameter to every query, a guard to every route, a scope to every list, a switcher to every shell, and a backfill to every existing row — and it does all of that in a codebase that already has forks depending on it. The cost curve is why this record is written **before any fork exists**, and why it is written **while D14 is being scoped rather than after**: D14 builds indexes, pagination behaviour, module generators and typed resource configs, and each of those is cheaper to build tenant-shaped than to reshape later.

Two preconditions are already in flight. Registration sits behind `FEATURE_USER_REGISTRATION` and its self-service UI was deliberately deferred by [ADR-0055](0055-customer-app.md) §5 (_the customer app_), so the sign-up transaction this record touches is not yet built — which is the good moment to decide what it does. And the API connects to Postgres as superuser today; the application role that D14's ADR-0061 introduces is the precondition for row-level security ever applying to it.

## Decision

A **delta** on ADR-0017 (the identity model gains an owning entity and a membership relation; both populations, their tables and their roles stand), on [ADR-0019](0019-authorization-guards.md) (_authorization guards_: a third guard joins `authenticate` and `authorize`, which are unchanged), and on [ADR-0015](0015-route-segments-and-versioning.md) (_route segments and versioning_: the `/user` segment gains a nested prefix; the three segments and the version are unchanged).

### 1. Isolation: shared database, shared schema

One database, one schema. Every tenant-owned table carries:

```
organization_id uuid not null references organizations(id)
```

with a **composite index led by `organization_id`**, because every query on such a table filters by it first. Neither schema-per-tenant nor database-per-tenant: both multiply migrations, connections and operational surface by the tenant count, for an isolation guarantee this record gets from the enforcement layer instead.

### 2. Model

```
organizations
-------------
id uuid pk, slug citext unique not null, name text not null
kind enum('personal','team') not null
created_by uuid not null, created_at, updated_at, deleted_at

organization_memberships
------------------------
organization_id uuid not null → organizations(id)
user_id uuid not null → users(id)
role enum('owner','admin','member') not null
created_at, updated_at
pk (organization_id, user_id), index (user_id)
```

`kind` and `role` are tuples in `@repo/contracts` consumed by `pgEnum` and by zod, per [ADR-0023](0023-shared-contracts-package.md) (_shared contracts package_): one declaration, two consumers.

**Sign-up creates a personal organization owned by the new user in the same transaction.** Every user therefore always has at least one organization, and **no query anywhere has a "no organization" branch** — which is the decision this clause is really making. A user may belong to many organizations; membership is many-to-many from the first day, so nothing has to migrate when the second one appears.

**Invitations** are part of the model — a table of pending invites by email, consumed on acceptance — but their flow needs the mail port of D14's ADR-0066, so the flow ships with the mail deliverable. The model is decided here; the delivery is not.

### 3. Staff are above tenants, never inside them

Staff are platform operators. **Staff are never members of an organization**, hold no membership row, and are not resolved through the membership guard. The admin segment gains `/admin/organizations`: an ordinary resource with list, get, create, update and delete plus a memberships sub-resource, mounted under `authorize("admin", "manager")` exactly as the users resource is (ADR-0019's admin resource rule), with writes narrowed where the resource warrants it.

### 4. Resolution: the active organization is in the URL

```
/api/v1/user/orgs/:orgId/...
```

and a **third guard**, beside `authenticate` and `authorize`:

```ts
requireMembership(...roles: OrganizationRole[]): RequestHandler
```

It loads the caller's membership for `:orgId`, **refuses a non-member with `404`, not `403`** — so organization existence is not leaked to someone who is not in it, the same reasoning ADR-0019 already applies to route existence — and places `ctx.organization = { id, role }` on the request context of [ADR-0010](0010-request-context.md) (_request context_), which services read as their first parameter like everything else there.

The URL is the resolution mechanism because it is linkable, bookmarkable, loggable and impossible to forget: a request either has an organization in its path or it is not an organization request.

**Self-scoped routes stay outside the prefix** — `/user/profile`, `/user/settings` and the `/user/orgs` listing are about the principal, not about a tenant, and adding an organization to them would be a lie about what they read.

### 5. Enforcement: unscoped is a compile error; RLS is designed in and deferred

Repositories for tenant-owned tables take the organization id from a **scoped executor or a required parameter — never an optional one**. A query on such a table written without it does not type-check. An ESLint rule in `packages/config-eslint/api.js` and the schema-enumeration test of D14's ADR-0061 back the type: the first stops the import, the second asserts that every tenant-owned table is in fact scoped.

**Row-level security is designed in and deliberately deferred.** The shape is fixed now so that enabling it later changes no repository:

- `SET LOCAL app.organization_id = $1` inside the request's transaction;
- a policy on every tenant-owned table reading that setting;
- the application database role of ADR-0061, so the policies actually apply — they do not apply to a superuser, which is why the role is the precondition.

Deferred means the cost is real: a transaction per request, pooler configuration, and a test harness that runs as the app role. Designed in means the day that cost is worth paying is a migration and a middleware, not a rewrite.

### 6. Client

`apps/customer` gets an **organization switcher in the shell header** and routes under `/orgs/$orgSlug/...`, mirroring the API so a customer URL and an API path say the same thing. `apps/admin` gets the organizations resource screen, built like any other resource.

### 7. Scope boundary

No billing, no plans, no SSO, and **no per-organization settings beyond name and slug** in v1. Each of those is its own deliverable and its own record; smuggling any of them in here would decide it by accident.

## Consequences

- Multi-tenancy exists before the first fork, so no fork carries the retrofit — the reason this is written ahead of the deliverable that builds it.
- D14 builds tenant-aware: composite indexes led by the tenant column, generators that emit the column and the scoped repository, configs that expect a scope.
- Every tenant-owned query gains a parameter and every list a scope; the type system makes forgetting one impossible rather than reviewable.
- One extra membership lookup per organization request, cacheable per request through `ctx`.
- The invitation flow and RLS are named follow-ups with their preconditions written down, not open questions.

## Alternatives considered

- **One organization per user.** Agencies and multi-team users cannot exist, and the migration to many-to-many later is exactly the retrofit this record is avoiding.
- **Nullable `organization_id`.** Every query grows a null branch, and the null branch is where the leaks live.
- **The active organization as a JWT claim.** Stale after a membership is revoked until the token expires, and a switch means re-minting a session to change a view.
- **A header (`X-Organization-Id`).** Easy for a client to forget, invisible in a shared link, and unbookmarkable.
- **RLS from day one.** A transaction per request plus pooler and harness complexity, before the model has ever been exercised. Deferred with its shape fixed, not rejected.
- **Schema- or database-per-tenant.** Strong isolation, and migrations, connections and backups multiplied by the tenant count.
