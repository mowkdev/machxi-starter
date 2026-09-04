# ADR-0067: Organizations — multi-tenancy as a first-class model (supersedes ADR-0017, 0019, 0015 and 0057 in part — deltas)

- Status: proposed
- Date: 2026-09-02
- Supersedes (each parent moves at the D15 step that makes its delta true — the `D10.5` precedent): [ADR-0017](0017-identity-model-populations-and-roles.md) (delta: the identity model gains an owning entity and a membership relation; both populations, their tables and their roles stand — moves at `D15.1`); [ADR-0019](0019-authorization-guards.md) (delta: a third guard, `requireMembership`, beside `authenticate` and `authorize`, which are unchanged — moves at `D15.2`); [ADR-0015](0015-route-segments-and-versioning.md) (delta: the `/user` segment gains the `/orgs/:orgId` prefix; the three segments and the version stand — moves at `D15.3`); [ADR-0057](0057-impersonation-sessions.md) (delta: §5's exclusion list grows the organization writes named in §8 below; every other impersonation decision stands — moves at `D15.3`)

> Written 2026-09-02 by `/scope` while scoping D14, for D15 ([`docs/plan/0015-organizations.md`](../plan/0015-organizations.md)) — written early so D14's steps are built tenant-aware. `proposed` at writing; **revised 2026-09-04 while `proposed`**, at `/scope D15`, with the four decisions the operator took there (the index rule, the personal organization's lifecycle, the impersonation exclusions, and the invitation flow without delivery) — each marked **Revised 2026-09-04** where it applies. Accepted at the head of `D15.1`, the step that builds the tables; amendable in place, labelled, while D15 is `in progress` ([the ledger](../plan/README.md#the-window)).

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

**Revised 2026-09-04 (`/scope D15`): tenant-led only, and the checker learns the scope.** [ADR-0063](0063-typed-resource-configs-and-generators.md) §3 recorded a tension `D14.11` found: `indexCoverage` in `@repo/db/testing` attributes an index to its *leading* column (ADR-0060 §3 asked for a set comparison, not a planner), so under tenant-led indexes alone every `sortable` column reads as uncovered, and the generator template declared both the tenant-led composites and the bare `(column, id)` pairs rather than settle it. This record settles it: a tenant-owned table declares **one** composite per order the endpoint offers, `(organization_id, column, id)`, and no bare pair — a query on such a table never orders unscoped, so a bare index would never be read, and two index sets per column is a write cost every fork would pay forever. `indexCoverage` gains a `scopedBy` option naming the scope column; on a table that declares it, an index whose first column is the scope covers its **second** column for ordering and filtering, with its own negative case. The `api-module` template drops the bare set. `organizations` itself is not tenant-owned — it is the tenant — and keeps ADR-0060 §3's bare pairs.

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

**Revised 2026-09-04 (`/scope D15`): every path, backfilled, with two invariants.** "Sign-up" above named one of three ways a user comes to exist. The invariant holds only if all of them create the personal organization in their own transaction — `POST /public/auth/register`, `POST /admin/users`, and the seeders — and only if the rows that already exist get one: the migration that creates the tables **backfills** a personal organization and an `owner` membership for every existing user, idempotently, so the claim is true on the day the tables land rather than for accounts created after it. Two invariants make the claim hold afterwards, and both take the shape ADR-0017 gave `super_admin`: **an organization always has at least one owner** — the last owner cannot leave, be removed or be demoted (a transaction-scoped advisory lock, as `lockRoleInvariant`, because a count under READ COMMITTED cannot see a concurrent sibling) — and **a personal organization cannot be deleted on its own**: it is soft-deleted inside the user's own deletion transaction (ADR-0028's user semantics, both the admin path and self-service), and its `kind` never changes. A `team` organization is created by any user through `POST /user/orgs`, with the caller as its owner, and may be deleted by an owner.

**Invitations** are part of the model — a table of pending invites by email, consumed on acceptance — but their flow needs the mail port of D14's ADR-0066, so the flow ships with the mail deliverable. The model is decided here; the delivery is not.

**Revised 2026-09-04 (`/scope D15`): the flow ships here, minus delivery.** Chosen at scoping over the alternative in which staff add members and the user segment only manages them.

```
organization_invitations
------------------------
id uuid pk, organization_id uuid not null → organizations(id)
email citext not null, role enum('admin','member') not null
invited_by uuid not null, expires_at, accepted_at, revoked_at
created_at, updated_at
index (organization_id, created_at, id), index (email)
```

An owner or admin creates an invitation by address and role on the user segment, lists the pending ones and revokes one; an authenticated user lists the pending invitations **addressed to their own email** and accepts or declines — acceptance inserts the membership and stamps the row in one transaction. `ORGANIZATION_INVITATION_TTL` bounds a row's life. **No email is sent**: the service has one marked call where the mail deliverable's send goes, and until then an invitee learns of an invitation by signing in. The design is enumeration-safe by construction rather than by care (ADR-0020 §Enumeration): an invitation names an *address*, not an account, so creating one neither looks an account up nor answers differently when none exists — the response is the same status and shape either way, and "this address is already a member" is the one distinguishable refusal, which tells the inviter only what the members list already shows. `owner` is not an invitable role; ownership is granted by an owner to an existing member.

### 3. Staff are above tenants, never inside them

Staff are platform operators. **Staff are never members of an organization**, hold no membership row, and are not resolved through the membership guard. The admin segment gains `/admin/organizations`: an ordinary resource with list, get, create, update and delete plus a memberships sub-resource, mounted under `authorize("admin", "manager")` exactly as the users resource is (ADR-0019's admin resource rule), with writes narrowed where the resource warrants it.

**Revised 2026-09-04 (`/scope D15`).** Every write on the resource and on its memberships sub-resource narrows to `admin`, the users resource's shape: a manager reads the tenant base and does not reshape it. The sub-resource adds a member **by user id** — staff already list accounts, so there is nothing to enumerate — and is the one path that grants membership without an invitation. Deletion is soft (`deleted_at`), the users precedent, and refuses a personal organization for the reason §2 gives.

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

**Revised 2026-09-04 (`/scope D15`).** Three things the sketch left to be guessed. The guard **lives in the organizations module**, not in `core/middleware`: it holds the memberships repository, and `core` must not import a module — the reason `authenticate` lives in the auth module (ADR-0011). Its two refusals are distinct: a non-member is `404` as above, and a member whose role is below the one required is `403 FORBIDDEN` — the caller is inside the organization and may know it exists, and the difference is what lets a client render "you are not an owner here" rather than a dead end. And `ctx.organization` carries `{ id, slug, role }`: the slug because the customer app's URLs are slugs (§6) and a service answering a slug-addressed screen should not have to look it up twice. `/user/invitations` — the invitee's own pending list, accept and decline — is self-scoped like `/user/orgs`: it is about the principal's address, and the organization is a column of the row rather than a segment of the path.

### 5. Enforcement: unscoped is a compile error; RLS is designed in and deferred

Repositories for tenant-owned tables take the organization id from a **scoped executor or a required parameter — never an optional one**. A query on such a table written without it does not type-check. An ESLint rule in `packages/config-eslint/api.js` and the schema-enumeration test of D14's ADR-0061 back the type: the first stops the import, the second asserts that every tenant-owned table is in fact scoped.

**Revised 2026-09-04 (`/scope D15`): what "backs the type" actually is.** The ESLint half is the rule that already exists — a table is importable only by a repository (ADR-0009's `noSchemaTables`, kept honest by ADR-0061 §4's enumeration test) — so the scope can only be forgotten inside one file per table, and no new rule is invented for a property a lint cannot see. The half that is new is a **hand-maintained `TENANT_OWNED_TABLES` list** beside the two ADR-0061 §4 already keeps, checked by the same test: every table carrying an `organization_id` column is in it, negative case included. A repository over a listed table takes the organization id as its first, required parameter; the one sanctioned exception is a read scoped by the **principal** rather than by a tenant — "the organizations this user belongs to", the switcher's query — which reads the membership table by `user_id` and is named for what it is. The generator template emits the required parameter (`D14.11`), so the shape is exercised rather than remembered.

**Row-level security is designed in and deliberately deferred.** The shape is fixed now so that enabling it later changes no repository:

- `SET LOCAL app.organization_id = $1` inside the request's transaction;
- a policy on every tenant-owned table reading that setting;
- the application database role of ADR-0061, so the policies actually apply — they do not apply to a superuser, which is why the role is the precondition.

Deferred means the cost is real: a transaction per request, pooler configuration, and a test harness that runs as the app role. Designed in means the day that cost is worth paying is a migration and a middleware, not a rewrite.

### 6. Client

`apps/customer` gets an **organization switcher in the shell header** and routes under `/orgs/$orgSlug/...`, mirroring the API so a customer URL and an API path say the same thing. `apps/admin` gets the organizations resource screen, built like any other resource.

**Revised 2026-09-04 (`/scope D15`).** The slug is resolved client-side against the `GET /user/orgs` query the switcher already holds — a slug outside the caller's memberships renders not-found without a request, which is the URL rule of §4 read from the browser. The organization's own settings section carries name and slug, the members with role change, removal and leaving, and the pending invitations with revoke; the caller's **received** invitations are a section of the account area, placed by [ADR-0053](0053-account-area.md)'s rule for sections. These are small lists, not the grid: [ADR-0055](0055-customer-app.md) §5 keeps `@repo/grid` for the first domain entity, and a members list is not one. **Self-service registration** — deferred by ADR-0055 §5 — becomes required here, because sign-up is what creates the personal organization: `/register` under the customer app's auth layout, over the existing public endpoint, behind `VITE_FEATURE_USER_REGISTRATION` in the client with `FEATURE_USER_REGISTRATION` on the API remaining the control. No email verification arrives with it; accounts are created `active`, as [ADR-0018](0018-authentication-sessions-and-tokens.md) decided.

### 7. Scope boundary

No billing, no plans, no SSO, and **no per-organization settings beyond name and slug** in v1. Each of those is its own deliverable and its own record; smuggling any of them in here would decide it by accident.

### 8. Impersonation: the exclusion list grows

**Revised 2026-09-04 (`/scope D15`)** — a delta on [ADR-0057](0057-impersonation-sessions.md) §5, which refuses an impersonated session the operations that would let an impersonator take the *account* over. An organization is a second thing to take over, and a support operator acting as a customer must not be able to hand a third party the customer's tenant. `refuseImpersonated` therefore also mounts on: changing a member's role, removing a member, leaving, transferring or granting ownership, deleting an organization, creating an invitation and accepting one. Name and slug edits stay allowed — they are what support opens the app to do — and land in the mutation trail with both identities like every other impersonated write (ADR-0058). One code for the class, `AUTH_IMPERSONATION_REFUSED`, as 0057 decided; the list is a property of the routes and is read in the route files, as 0057's was.

## Consequences

- Multi-tenancy exists before the first fork, so no fork carries the retrofit — the reason this is written ahead of the deliverable that builds it.
- D14 builds tenant-aware: composite indexes led by the tenant column, generators that emit the column and the scoped repository, configs that expect a scope.
- Every tenant-owned query gains a parameter and every list a scope; the type system makes forgetting one impossible rather than reviewable.
- One extra membership lookup per organization request, cacheable per request through `ctx`.
- The invitation flow ships without its delivery; the send is one marked call for the mail deliverable to fill. RLS remains a named follow-up with its preconditions written down.
- Every existing user gains a personal organization by migration, and every fixture and test that creates a user creates one — the tests that assert "exactly one" are what keep the invariant a fact rather than a sentence.
- A frozen record, ADR-0057, takes a delta for the exclusion list; the alternative — allowing every organization write under impersonation, audited — was offered and declined because an audited tenant takeover is still a takeover.

## Alternatives considered

- **One organization per user.** Agencies and multi-team users cannot exist, and the migration to many-to-many later is exactly the retrofit this record is avoiding.
- **Nullable `organization_id`.** Every query grows a null branch, and the null branch is where the leaks live.
- **The active organization as a JWT claim.** Stale after a membership is revoked until the token expires, and a switch means re-minting a session to change a view.
- **A header (`X-Organization-Id`).** Easy for a client to forget, invisible in a shared link, and unbookmarkable.
- **RLS from day one.** A transaction per request plus pooler and harness complexity, before the model has ever been exercised. Deferred with its shape fixed, not rejected.
- **Schema- or database-per-tenant.** Strong isolation, and migrations, connections and backups multiplied by the tenant count.
- **Both index sets on a tenant-owned table** (the `D14.11` template as shipped). Green against the checker as it was, at twice the write cost per sortable column on every tenant table in every fork. Rejected for one composite per order and a checker that understands a scope.
- **Staff add members; the user segment only manages them** (the recommendation at scoping). Nothing to enumerate and nothing smuggled, but no way for a customer to bring a colleague in until the mail deliverable. Declined by the operator for the flow without delivery.
- **Adding a member by email directly on the user segment.** The smallest UX, and a `201`/`404` split that tells any organization owner which addresses hold accounts — ADR-0020 §Enumeration's failure — while a uniform `204` silently does nothing for an unknown one. Rejected for an invitation that names an address and never looks one up.
