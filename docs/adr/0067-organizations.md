# ADR-0067: Organizations — multi-tenancy as a first-class model (supersedes ADR-0017, 0019, 0015 and 0057 in part — deltas)

- Status: accepted
- Date: 2026-09-02
- Supersedes (each parent moves at the D15 step that makes its delta true — the `D10.5` precedent): [ADR-0017](0017-identity-model-populations-and-roles.md) (delta: the identity model gains an owning entity and a membership relation; both populations, their tables and their roles stand — **moved 2026-09-04 at `D15.1`**); [ADR-0019](0019-authorization-guards.md) (delta: a third guard, `requireMembership`, beside `authenticate` and `authorize`, which are unchanged — **moved 2026-09-04 at `D15.2`**); [ADR-0015](0015-route-segments-and-versioning.md) (delta: the `/user` segment gains the `/orgs/:orgId` prefix; the three segments and the version stand — moves at `D15.3`); [ADR-0057](0057-impersonation-sessions.md) (delta: §5's exclusion list grows the organization writes named in §8 below; every other impersonation decision stands — moves at `D15.3`)

> Written 2026-09-02 by `/scope` while scoping D14, for D15 ([`docs/plan/0015-organizations.md`](../plan/0015-organizations.md)) — written early so D14's steps are built tenant-aware. `proposed` at writing; **revised 2026-09-04 while `proposed`**, at `/scope D15`, with the four decisions the operator took there (the index rule, the personal organization's lifecycle, the impersonation exclusions, and the invitation flow without delivery) — each marked **Revised 2026-09-04** where it applies. **Accepted 2026-09-04 at the head of `D15.1`**, the step that builds the tables, where [ADR-0017](0017-identity-model-populations-and-roles.md) moved to `superseded by`; amendable in place, labelled, while D15 is `in progress` ([the ledger](../plan/README.md#the-window)).

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
invited_by uuid not null, token_hash text not null unique
expires_at, accepted_at, declined_at, revoked_at
created_at, updated_at
index (organization_id, created_at, id), index (email)
```

**Amended 2026-09-04 (`D15.1`).** Three things the sketch above left unsaid, decided by the step that built the tables.

- **There is no `status` column, and `INVITATION_STATUSES` is derived.** The plan asked for the tuple in `@repo/contracts` beside `ORGANIZATION_KINDS` and `ORGANIZATION_ROLES`, "one declaration, `pgEnum` and zod both consuming it" — and it cannot be, for a reason worth recording rather than working around: `expired` is a state no column can hold. It becomes true as the clock passes `expires_at`, with no row written and — by this record's own scope boundary — no sweeper to write one. A stored status would therefore say `pending` about an expired row, which is the class of bug a second source of truth exists to create. The row's state is its timestamps; the tuple is the **wire** form, consumed by zod alone, and the mapper folds the four columns into one of its five values. The sketch gains `declined_at` beside `accepted_at` and `revoked_at`, because declining is one of the three ways an invitation ends and the sketch had nowhere to put it.
- **`role enum('admin','member')` is the shared `organization_role` type with a check constraint**, not a second Postgres enum over two of its three labels. `owner` is not invitable, as above; that is one rule, said in the table as `check (role <> 'owner')` and in the zod schema as a narrowing of the one tuple. A second enum would be a second thing to keep in step with the first for the rest of the repository's life.
- **`slug` is unique among live rows only**, not outright. The sketch above writes `slug citext unique not null`; the table ships the partial form — unique `where deleted_at is null` — which is the `users_email_active_unique` decision of [ADR-0028](0028-user-lifecycle-and-deletion.md) applied to the second soft-deletable table in the schema, and it has the same consequence stated the same way: deleting an organization **releases its slug**, so a `/orgs/$orgSlug` link can later resolve to a different organization. That is the trade, taken deliberately: without it a deleted organization reserves its name forever and "we deleted the old team and want the name back" has no answer. It is also the conflict target every create must name with its predicate, because an insert naming a constraint that does not exist matches no index and escapes as a `500` rather than the `CONFLICT` the caller is owed.
- **A personal organization's slug is derived from the user's id** — `personal-<uuid>` — in the backfill migration and in every path that creates one. Deterministic, so the backfill is idempotent without a journal and two concurrent creates cannot mint two slugs for one account; collision-free, so nothing retries against the partial unique index; and it **leaks no address**, which is the half that made the choice: a slug is a URL segment (§6), a URL is pasted into chat windows and bug reports, and a slug derived from an address would put that address in every one of them (§Enumeration of [ADR-0020](0020-security-baseline.md)). Not "leaks nothing" — a UUIDv7 carries a millisecond timestamp, so the slug does disclose when the account was created, and it puts the user's primary key in a URL. That exposure is bounded by the fact that a personal organization has exactly one member: only its owner and staff ever see the slug, and no surface a second party reads may carry one. It is ugly, and that is the right trade for an organization whose only member is its owner and whose *name* is what the switcher renders; a user who wants a pretty URL creates a `team` organization. The prefix is **reserved** in `slugSchema` so a user cannot choose one and make somebody's personal organization silently unwritable.

**Amended 2026-09-04 (the operator's answer to `D15.1`'s escalation): the row carries a single-use token from this window on, and D15 does not read it.** `D15.1`'s security review escalated the exposure §Consequences states — an invitation is claimed by address match alone, and nothing here verifies an address — with two answers and no authority to pick one. The operator picked the column, on the ground `D15.1` gave for asking now rather than later: it is a migration against an empty table while this window is open, and a migration against a table with a live accept path on it after `D15.3`.

- **`token_hash text not null`, unique** — SHA-256 of an opaque token, base64url, the `sessions.refresh_token_hash` shape of [ADR-0018](0018-authentication-sessions-and-tokens.md) as [ADR-0057](0057-impersonation-sessions.md) §2 already applied it to `impersonation_handoffs`. **The mint is `randomToken()` from `@repo/crypto` at its default 32 bytes** — 256 bits, ADR-0018's figure — said here rather than left to the create path, because this is the one credential in the schema whose lookup is scoped by nothing else (§5) and a fork that minted something short would weaken it silently. Only the hash is kept, so a database read yields no usable credential, and the column is **never mapped onto the wire**: it is dropped from every resource the way `password_hash` and `refresh_token_hash` are, which is a rule of ADR-0009's mappers and not a precedent any mapper sets today. `not null`, so the accept path never grows a "this row has no token" branch — the reasoning this record gives for refusing a nullable `organization_id`, applied to a credential. The unique constraint is what makes a lookup by token a lookup rather than a scan; it is a **credential** constraint and not a list index, so §1's "no bare pairs on a tenant-owned table" does not reach it — nothing orders or paginates by a hash, and `token_hash` enters no `sortable`, `filterable` or searchable allow-list.
- **Single use needs no column of its own.** An invitation ends exactly once and the three terminal stamps above already say so, so the consume is one guarded statement — `impersonation_handoffs`' atomic consume over stamps this table already had:

  ```sql
  update organization_invitations i set accepted_at = now()
   where i.token_hash = $1 and i.accepted_at is null and i.declined_at is null
     and i.revoked_at is null and i.expires_at > now()
     and exists (select 1 from organizations o
                  where o.id = i.organization_id and o.deleted_at is null)
  returning i.*
  ```

  The `exists` clause is not optional and is the half a sketch loses first: `organization_id` cascades on a **hard** delete only, so an invitation outlives its organization's soft delete, and an accept without it grants membership in a deleted tenant. A `token_used_at` beside the stamps would be a second source of truth for "this invitation is over", which is what the missing `status` column was refused for three bullets above.
- **It is unused in D15, and that is the point.** Acceptance still matches by address, because no deliverable here can put a token in front of an invitee: D15 sends no mail. `D15.3` mints the token and stores its hash — a `not null` column obliges it, and that is the whole of the change to D15's behaviour, since nothing returns the token, no endpoint takes one and no query reads the column. The day the mail deliverable adds the send at §2's marked call, the accept path can begin **requiring** the token without a migration and without a backfill, because every row created since this window carries one.
- **The residual risk is accepted, not fixed, by this.** For the life of D15 an invitation is still claimed by address match alone; §Consequences states that exposure and continues to.

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

**Revised 2026-09-04 (`/scope D15`): what "backs the type" actually is.** The ESLint half is the rule that already exists — a table is importable only by a repository (ADR-0009's `noSchemaTables`, kept honest by ADR-0061 §4's enumeration test) — so the scope can only be forgotten inside one file per table, and no new rule is invented for a property a lint cannot see. The half that is new is a **hand-maintained `TENANT_OWNED_TABLES` list** beside the two ADR-0061 §4 already keeps, checked by the same test: every table carrying an `organization_id` column is in it, negative case included. A repository over a listed table takes the organization id as its first, required parameter; the sanctioned exception is a read scoped by the **principal** rather than by a tenant — "the organizations this user belongs to", the switcher's query — which reads the membership table by `user_id` and is named for what it is. The generator template emits the required parameter (`D14.11`), so the shape is exercised rather than remembered.

**Amended 2026-09-04 (`D15.1`): the exception is a class, not a count.** The clause above read "the one sanctioned exception", and building the tables proved that too narrow by exactly one. §4 places `/user/invitations` outside the `/orgs/:orgId` prefix as well, and the invitee's own pending list reads `organization_invitations` — a tenant-owned table — by `email`, without a tenant, because the caller is asking about their own address and does not yet know which organizations are involved. It is the same shape as the switcher's query and is indexed for it (`organization_invitations_email_idx` beside `organization_memberships_user_id_idx`). The rule is therefore stated as a class: **a read scoped by the principal is sanctioned; a read scoped by nothing is not**, and each such read is named in its repository for what it is. Counting the instances was the mistake — a record decides and does not enumerate ([ADR-0050](0050-adr-lifecycle-and-verification.md)).

**Amended 2026-09-04 (the operator's answer to `D15.1`'s escalation): a read by the invitation's token hash is in that class, with two conditions.** No such read exists in D15 — §2's column is written and queried by nothing — but the day the mail deliverable builds the accept-by-token path, that read carries no tenant either. It is sanctioned for the same reason the two above are: it is scoped by the 256 bits §2 fixes the mint at, it lands on exactly one row through `organization_invitations_token_hash_unique`, and it is named in its repository for what it is. What stays refused is the third thing — a read scoped by nothing.

The two conditions are what a secret-only lookup owes, and they are stated here so the deliverable that builds it inherits them rather than invents them. **It is rate-limited as an authentication route is** ([ADR-0020](0020-security-baseline.md)'s limiter class for `login` and `refresh`, not the general one): guessing is the only attack on a lookup with no other scope. And **holding the token authorises reading and consuming that one invitation, nothing more** — it is not authority to decide *whose* membership is created. Which account joins is the accept path's decision, made from the authenticated caller, and the row keeps both facts: the address invited and, by `accepted_at` with the membership it wrote, the account that accepted. Whether that path binds acceptance to the bearer or to a verified address is the decision that actually closes `D15.1`'s finding, and it belongs to the deliverable that ships the send.

**Row-level security is designed in and deliberately deferred.** The shape is fixed now so that enabling it later changes no repository:

- `SET LOCAL app.organization_id = $1` inside the request's transaction;
- a policy on every tenant-owned table reading that setting;
- the application database role of ADR-0061, so the policies actually apply — they do not apply to a superuser, which is why the role is the precondition.

Deferred means the cost is real: a transaction per request, pooler configuration, and a test harness that runs as the app role. Designed in means the day that cost is worth paying is a migration and a middleware, not a rewrite.

### 6. Client

`apps/customer` gets an **organization switcher in the shell header** and routes under `/orgs/$orgSlug/...`, mirroring the API so a customer URL and an API path say the same thing. `apps/admin` gets the organizations resource screen, built like any other resource.

**Revised 2026-09-04 (`/scope D15`).** The slug is resolved client-side against the `GET /user/orgs` query the switcher already holds — a slug outside the caller's memberships renders not-found without a request, which is the URL rule of §4 read from the browser. The organization's own settings section carries name and slug, the members with role change, removal and leaving, and the pending invitations with revoke; the caller's **received** invitations are a section of the account area, placed by [ADR-0053](0053-account-area.md)'s rule for sections. These are small lists, not the grid: [ADR-0055](0055-customer-app.md) §5 keeps `@repo/grid` for the first domain entity, and a members list is not one. **Self-service registration** — deferred by ADR-0055 §5 — becomes required here, because sign-up is what creates the personal organization: `/register` under the customer app's auth layout, over the existing public endpoint, behind `VITE_FEATURE_USER_REGISTRATION` in the client with `FEATURE_USER_REGISTRATION` on the API remaining the control. No email verification arrives with it; accounts are created `active`, as [ADR-0018](0018-authentication-sessions-and-tokens.md) decided.

**Amended 2026-09-07 (`D15.9`, the operator's decision after the `D15.8` browser walk): the private context is the root, and only a team is addressed.** What `D15.5` built made the switcher a list of links to an organization's summary card, whose one action was its settings — so "switching" read as "opening settings", nothing in the app was ever _the organization the caller acts as_, and the personal organization's derived slug stood in every URL of the context a private person spends most of their time in. Three things move; the model does not.

- **Two addresses, one page.** A tenant screen exists at `/<screen>`, acting as the caller's **personal** organization, and at `/orgs/$orgSlug/<screen>`, acting as a **team** — both mounting the same page, which takes the resolved organization. One resolver in the client answers "which organization am I acting as": the slug's organization when the path carries one, the personal one when it does not. It is the only place that rule is written; every tenant page, the switcher and the sidebar's links read it. The `/orgs/` literal stays, so a team's slug can never collide with a top-level route — without it every route name would have to be reserved in the slug namespace forever. `/` is the private home and `/orgs/$orgSlug` the team's; the summary card retires. **The API is untouched**: a request made from an unprefixed screen still carries the personal organization's id in `/user/orgs/:orgId/...`, resolved from the `GET /user/orgs` list the shell already holds, and §2's invariant — every account has exactly one personal organization — is what makes that resolution total rather than a null branch.
- **The switcher switches; it does not navigate to a screen.** Choosing a context keeps the screen and swaps the prefix; a screen with no counterpart in the chosen context (a team's settings, chosen from the private entry) lands on that context's home. The personal entry is labelled as private and shows no slug; the trigger always names the context the caller is acting in. Its menu carries the way into the active team's settings and the way to create a team, the account menu's own shape (ADR-0053 §2) — so neither is a card on another organization's screen, which is where `D15.5` had put "new organization".
- **The personal organization has no settings surface.** Its slug is derived, it cannot be deleted or invite, its only member is the caller, and its name is **unmanaged** — the interface calls it "Private" and nothing edits it. `/orgs/<personal slug>` and anything under it render not-found. A **team's** settings are an area under `/orgs/$orgSlug/settings` on the same composition as `/account` (ADR-0053 §4's second consumer, which that record anticipated): general (name, address, deletion), members, invitations. ADR-0053 §1's section rule is kept, not stretched: the account area stays about the person, and a tenant's members and invitations never sit under a personal heading.

**The last active context is remembered per device and per principal** — the ADR-0046 §4 device-key precedent; no setting, no column, nothing on the wire — and read in exactly two places. Where **sign-in lands** when the guard recorded no `redirect`: the remembered team's home, or `/` when nothing is remembered. And what the shell's switcher and links show while the caller stands on a **self-scoped** screen (`/account/*`), so opening one's profile from a team does not eject one into the private context on the way back. A tenant screen never reads it — its context is its URL, which is the rule of §4 unchanged. A remembered slug outside the caller's memberships falls back to the private context silently; an impersonated session reads the customer's key, never the operator's, because the key is the principal's.

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
- **An invitation is claimed by address match alone, and this repository verifies no address** (`D15.1`'s security review). §2 makes creation enumeration-safe by construction, and the exposure is at the other end: registration is self-service and creates `active` accounts with no verification (ADR-0018), and until the mail deliverable an invitee "learns of an invitation by signing in" — so whoever registers an address is the invitee, and cross-tenant membership is reachable without ever controlling it. The two answers were a single-use token on the row (the ADR-0018 refresh-token shape, unused until the send exists) and gating acceptance on a verified address. **The operator took the first, 2026-09-04, as the column and not as the gate**: §2's `token_hash` exists from this window on and `D15.3` mints it, so the accept path can begin requiring the token the day the send lands, without a migration against a table that by then has an accept path built on it. **The exposure itself is unchanged and is accepted, not fixed**, because nothing here can deliver a token to an invitee: for the life of D15 an invitation is still claimed by address match alone, and the second answer — a verified address — is not taken at all. The deliverable that adds the send is the one that closes this, and the column is what lets it close cheaply.

## Alternatives considered

- **One organization per user.** Agencies and multi-team users cannot exist, and the migration to many-to-many later is exactly the retrofit this record is avoiding.
- **Nullable `organization_id`.** Every query grows a null branch, and the null branch is where the leaks live.
- **The active organization as a JWT claim.** Stale after a membership is revoked until the token expires, and a switch means re-minting a session to change a view.
- **A header (`X-Organization-Id`).** Easy for a client to forget, invisible in a shared link, and unbookmarkable.
- **RLS from day one.** A transaction per request plus pooler and harness complexity, before the model has ever been exercised. Deferred with its shape fixed, not rejected.
- **Schema- or database-per-tenant.** Strong isolation, and migrations, connections and backups multiplied by the tenant count.
- **Both index sets on a tenant-owned table** (the `D14.11` template as shipped). Green against the checker as it was, at twice the write cost per sortable column on every tenant table in every fork. Rejected for one composite per order and a checker that understands a scope.
- **Staff add members; the user segment only manages them** (the recommendation at scoping). Nothing to enumerate and nothing smuggled, but no way for a customer to bring a colleague in until the mail deliverable. Declined by the operator for the flow without delivery.
- **Gating acceptance on a verified address** — the other answer to `D15.1`'s escalated finding. It closes the exposure outright rather than shaping the row for the deliverable that will, and it cannot be built here: verification is an email flow, D15 ships no delivery, and ADR-0018's `active`-on-registration is a decision this record explicitly does not reopen (§6). Declined by the operator on 2026-09-04 in favour of §2's token column, which the mail deliverable turns into the same guarantee at the cost of one `not null` column carried unused through D15.
- **The active organization as a stored setting, with every tenant URL unprefixed** (offered 2026-09-07 beside §6's amendment). "Which account I work from" as a column on `user_settings`, the switcher writing it, `/orders` meaning whatever it was last set to. It reads cleaner and makes a shared link mean a different tenant for each reader, lets two tabs fight over one setting, needs a migration, and the client still has to put an id into every API path — so it buys the ambiguity §4 rejected for headers and claims at the cost of a setting. Declined by the operator for the private context at the root and a team in the path.
- **The personal organization addressed like a team** (`D15.5` as built): `/orgs/personal-<uuid>/...` for the context a private person lives in, and a settings screen whose every control is refused or pointless there. Replaced by §6's amendment.
- **Adding a member by email directly on the user segment.** The smallest UX, and a `201`/`404` split that tells any organization owner which addresses hold accounts — ADR-0020 §Enumeration's failure — while a uniform `204` silently does nothing for an unknown one. Rejected for an invitation that names an address and never looks one up.
