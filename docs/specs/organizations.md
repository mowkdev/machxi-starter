# Organizations

Every user belongs to organizations; each membership carries a role; staff are above all of them. A request that addresses an organization names it in its path and a guard resolves the caller's membership of it; requests about the caller — which organizations they have, which invitations are addressed to them — stay outside that prefix. Staff manage the tenant base as an ordinary admin resource and are never members of anything. The customer app's switcher and its screens follow with the deliverable in progress.

## Requirement: Every live user has exactly one personal organization

A user account always owns a `personal` organization with an `owner` membership: the migration that created the tables backfilled one for every existing live account, and the dev seeds create one per fixture user. Both are idempotent — a second run changes no row. A team organization (`acme` in the dev fixtures) has an owner and members like any other.
Records: [ADR-0067](../adr/0067-organizations.md)
Proved by: `packages/db/src/__tests__/seeds.int.test.ts`

### Scenario: After the seeds

- **WHEN** `pnpm db:seed -- --dev` has run against a database with no organizations
- **THEN** every live user has one `personal` organization it owns, and running the seeds again leaves every count unchanged

## Requirement: Creating an account creates its personal organization in the same transaction

Both paths that bring a user account into existence — self-registration on the public segment and staff creating one on the admin segment — create a `personal` organization owned by the new account, with an `owner` membership, in the transaction that inserts the account. Its slug is derived from the account's id rather than from its address, so no URL carrying it discloses one, and its name is the account's own name when it has one and its address when it does not. A creation that is refused as a duplicate writes no organization at all.
Records: [ADR-0067](../adr/0067-organizations.md), [ADR-0018](../adr/0018-authentication-sessions-and-tokens.md)
Proved by: `apps/api/test/auth-register.int.test.ts`, `apps/api/test/users-admin.int.test.ts`, `apps/api/src/modules/organizations/__tests__/organizations.service.test.ts`

### Scenario: A registration succeeds

- **WHEN** `POST /api/v1/public/auth/register` answers `201`
- **THEN** the new account owns exactly one live `personal` organization whose slug is derived from its id, and holds the `owner` membership of it

### Scenario: A registration is refused as a duplicate

- **WHEN** `POST /api/v1/public/auth/register` answers `409 CONFLICT` for an address that already has an account
- **THEN** the number of live organizations is unchanged

## Requirement: Closing an account closes the personal organization with it

Both deletion paths — staff deleting a customer, and the account closing itself — soft-delete the account's `personal` organization in the same transaction as the account, stamped with the same timestamp. The memberships of that organization survive, because nothing cascades on a soft delete; the team organizations the account owns are untouched. A personal organization is never deleted on its own: a `DELETE` aimed at one answers `409 ORGANIZATION_PERSONAL_UNDELETABLE`.
Records: [ADR-0067](../adr/0067-organizations.md), [ADR-0028](../adr/0028-account-deletion.md)
Proved by: `apps/api/test/users-admin.int.test.ts`, `apps/api/test/user-profile.int.test.ts`, `apps/api/src/modules/organizations/__tests__/organizations.service.test.ts`

### Scenario: An account is deleted

- **WHEN** `DELETE /api/v1/admin/users/:id` or `DELETE /api/v1/user/profile` answers `204`
- **THEN** the account's `personal` organization carries the same `deleted_at` as the account, and the team organizations it created carry none

## Requirement: An organization always keeps at least one owner

Removing, demoting or leaving as the only remaining `owner` of an organization is refused with `409 ORGANIZATION_LAST_OWNER`. Only an owner whose account is still open counts: closing an account leaves its team memberships in place, so an owner nobody can sign in as does not keep an organization administrable. Every membership write is serialised per organization from before it reads a role, so two concurrent requests cannot each conclude the other is the survivor. The refusal is a conflict and not a forbidding: the caller may hold exactly the role the operation requires, and what the request conflicts with is the organization's state.
Records: [ADR-0067](../adr/0067-organizations.md), [ADR-0017](../adr/0017-identity-model-populations-and-roles.md)
Proved by: `apps/api/src/modules/organizations/__tests__/organizations.service.test.ts`, `apps/api/test/organizations-repositories.int.test.ts`

### Scenario: The last owner is demoted

- **WHEN** the only `owner` of an organization is given a lower role
- **THEN** the request is refused `409 ORGANIZATION_LAST_OWNER` and the membership is unchanged

### Scenario: The other owner has closed their account

- **WHEN** an organization's two owners are one open account and one closed one
- **THEN** the open account counts as the last owner and cannot leave or be demoted

## Requirement: A request addressed to an organization is resolved by membership, and a non-member is not told it exists

An organization-scoped request names the organization in its path, and a guard resolves the caller's membership of it before any handler runs. A caller who is not a member — and a caller naming an organization that does not exist, or one that has been soft-deleted, or an identifier that is not one at all — is answered `404 NOT_FOUND`, the same answer in every case, so organization existence is disclosed to nobody outside it. A caller who **is** a member but whose role is below the one the route requires is answered `403 FORBIDDEN` instead, because they may already know the organization exists. There is no role hierarchy: a route that admits owners and admins names both.
Records: [ADR-0067](../adr/0067-organizations.md), [ADR-0019](../adr/0019-authorization-guards.md), [ADR-0015](../adr/0015-route-segments-and-versioning.md)
Proved by: `apps/api/src/modules/organizations/__tests__/require-membership.test.ts`, `apps/api/test/organizations.int.test.ts`

### Scenario: A stranger names an organization

- **WHEN** an authenticated user addresses an organization they hold no membership of
- **THEN** the answer is `404 NOT_FOUND`, indistinguishable from an organization that does not exist

### Scenario: A member's role is too low

- **WHEN** a `member` addresses a route that requires `owner`
- **THEN** the answer is `403 FORBIDDEN`

## Requirement: A soft-deleted organization stops being a tenant

Deleting an organization is soft, and nothing cascades on a soft delete — its memberships and its invitations survive the row being stamped. Every read that could grant access through one therefore filters on the organization still being live: a membership of a deleted organization resolves to nothing, so the guard answers `404`; a pending invitation into one is neither listed nor acceptable. A deleted organization releases its slug, so the same name may later address a different one.
Records: [ADR-0067](../adr/0067-organizations.md), [ADR-0028](../adr/0028-account-deletion.md)
Proved by: `apps/api/test/organizations-repositories.int.test.ts`

### Scenario: An invitation outlives its organization

- **WHEN** an organization holding a pending invitation is soft-deleted
- **THEN** the invitation row is still there, is absent from the invitee's pending list, and cannot be accepted

## Requirement: A tenant-owned table is scoped, and the scope is enumerated

Every table that references `organizations` carries `organization_id not null`, leads every index that serves an order with it, and is named in the tenant-owned enumeration that the schema tests diff against the tables themselves — so a table that escapes the list, or an index that does not lead with the scope, fails a test rather than a review.
Records: [ADR-0067](../adr/0067-organizations.md), [ADR-0061](../adr/0061-database-roles-and-append-only-enforcement.md), [ADR-0060](../adr/0060-list-endpoints-at-scale.md)
Proved by: `packages/db/src/__tests__/enumerations.test.ts`, `packages/db/src/__tests__/schema.test.ts`

### Scenario: A table missing from the list

- **WHEN** a table with a foreign key to `organizations` is not in the tenant-owned enumeration
- **THEN** the enumeration test fails naming it

## Requirement: Slugs are unique among live organizations and never impersonate a personal one

An organization's slug is unique among organizations that are not soft-deleted, so a deleted organization releases its slug; the prefix reserved for personal organizations cannot be chosen for a team, so a personal organization cannot be shadowed by a squatted slug.
Records: [ADR-0067](../adr/0067-organizations.md)
Proved by: `packages/db/src/__tests__/schema.int.test.ts`, `packages/contracts/src/__tests__/primitives.test.ts`

### Scenario: The same slug twice

- **WHEN** a second live organization is inserted with a slug a live one holds
- **THEN** the insert fails on the partial unique index

## Requirement: A user reads and creates their own organizations outside the prefix

`GET /api/v1/user/orgs` answers the caller's own organizations, each carrying the role that got them there, personal one first. It takes no list-query language: a person belongs to a handful of organizations, not a page of them, and the read is scoped by the principal rather than by a tenant. It is never empty for a live account. `POST /api/v1/user/orgs` creates a `team` organization with the caller as its owner and answers `201`; it takes no `kind`, because a personal organization is the system's to create. A slug a live organization already holds is refused `409 CONFLICT` whose body says nothing about what holds it, and a slug in the reserved personal prefix is refused `400 VALIDATION_ERROR`.
Records: [ADR-0067](../adr/0067-organizations.md), [ADR-0014](../adr/0014-pagination-filtering-sorting.md)
Proved by: `apps/api/test/organizations.int.test.ts`

### Scenario: A fresh account lists its organizations

- **WHEN** an account that has just registered calls `GET /api/v1/user/orgs`
- **THEN** it is answered one organization — its own `personal` one, with role `owner`

### Scenario: A slug that is taken

- **WHEN** `POST /api/v1/user/orgs` names a slug a live organization holds
- **THEN** the answer is `409 CONFLICT` and the body names neither the holder nor its kind

## Requirement: Name and slug are all an organization has, and a personal one keeps its slug

`PATCH` on either segment accepts `name` and `slug` and nothing else — `kind` never changes and `createdBy` is history. An owner or admin may edit on the user segment; an `admin` staff member may on the admin one. A slug edit aimed at a `personal` organization is refused `409 ORGANIZATION_PERSONAL_UNDELETABLE`, because that slug is derived from the account's id and the derivation is what proves the account has exactly one; its **name** is freely editable. A slug another live organization holds is `409 CONFLICT`.
Records: [ADR-0067](../adr/0067-organizations.md)
Proved by: `apps/api/test/organizations.int.test.ts`, `apps/api/test/organizations-admin.int.test.ts`

### Scenario: Renaming a personal organization

- **WHEN** an owner sends `{ "name": … }` for their personal organization, and then `{ "slug": … }`
- **THEN** the first answers `200` and the second `409 ORGANIZATION_PERSONAL_UNDELETABLE`

## Requirement: Members are listed by any member, and removal is either a removal or a leaving

`GET .../members` answers any member of the organization, on ADR-0014's list language and tenant-scoped so no query string can widen it. `PATCH .../members/:userId` changes a role and is an **owner's** alone, because granting `owner` is how ownership moves. `DELETE .../members/:userId` admits any member: removing somebody else needs `owner` or `admin` and is otherwise `403 FORBIDDEN`, while removing yourself — leaving — needs only that the member named is the caller. Both refuse the last owner with `409 ORGANIZATION_LAST_OWNER`.
Records: [ADR-0067](../adr/0067-organizations.md), [ADR-0019](../adr/0019-authorization-guards.md)
Proved by: `apps/api/test/organizations.int.test.ts`

### Scenario: A member removes somebody else

- **WHEN** a `member` sends `DELETE .../members/:userId` naming another account
- **THEN** the answer is `403 FORBIDDEN`, and the same request naming themselves answers `204`

## Requirement: An invitation names an address, and creating one is not an oracle

`POST /api/v1/user/orgs/:orgId/invitations` takes an address and a role, is open to an owner or admin, and answers `201`. It never looks an account up, so the status and the body's shape are **identical** for an address that has an account and one that does not. `owner` is not an invitable role and is refused `400 VALIDATION_ERROR`. Three things are refused `409`, each telling the inviter only what their own organization's lists already show them: an address already inside it (`CONFLICT`), an address that already has an outstanding invitation to it (`ORGANIZATION_INVITATION_PENDING` — one live offer per address, since nothing in the schema bounds them), and any invitation at all into a `personal` organization (`ORGANIZATION_PERSONAL_CLOSED`), which has exactly one member. A member who closed their account does not count as one: their membership survives, their address is released, and inviting the address again succeeds. The row carries a single-use token whose SHA-256 is stored and whose plaintext is returned to nobody; no response body carries either, and the digest is in no sort, filter or search allow-list, so `sort=tokenHash` is `400 VALIDATION_ERROR`.
Records: [ADR-0067](../adr/0067-organizations.md), [ADR-0020](../adr/0020-security-baseline.md), [ADR-0060](../adr/0060-list-endpoints-at-scale.md)
Proved by: `apps/api/test/organizations.int.test.ts`, `apps/api/src/modules/organizations/__tests__/organizations.list-indexes.test.ts`

### Scenario: Inviting two addresses, one of which has an account

- **WHEN** an owner invites an address with an account and an address without
- **THEN** both answer `201` with the same fields, and neither response nor either list carries the token or its digest

### Scenario: Inviting the same address twice

- **WHEN** an owner invites an address that already has an outstanding invitation to the same organization
- **THEN** the answer is `409 ORGANIZATION_INVITATION_PENDING`, and it succeeds again once the first is revoked

## Requirement: An invitee acts on invitations addressed to them, and only once

`GET /api/v1/user/invitations` answers the pending invitations addressed to the caller's own address, each carrying the organization's name; the address is read from the account, not from the request. `POST /api/v1/user/invitations/:id/accept` answers `200` with the organization joined and the role invited; `/decline` answers `204` and joins nothing. An invitation addressed to somebody else is `404 NOT_FOUND` whichever is attempted. Acting on one that has already been accepted, declined, revoked or expired — or whose organization has been deleted — answers `409 CONFLICT`, one answer for all five. Revoking is an owner's or admin's, and a revoked invitation disappears from the invitee's list.
Records: [ADR-0067](../adr/0067-organizations.md)
Proved by: `apps/api/test/organizations.int.test.ts`, `apps/api/test/organizations-repositories.int.test.ts`

### Scenario: Accepting twice

- **WHEN** an invitee accepts a pending invitation and then accepts it again
- **THEN** the first answers `200` with the organization, and the second `409 CONFLICT`

### Scenario: An expired invitation

- **WHEN** the clock has passed an invitation's expiry
- **THEN** it is absent from the invitee's pending list and accepting it answers `409 CONFLICT`

## Requirement: Staff manage the tenant base as a resource and are never members

`/api/v1/admin/organizations` mounts for `admin` and `manager`; every writing route — create, update, delete, and the four on the memberships sub-resource — narrows to `admin`. Every row's `role` is `null`, staff holding no membership. The list speaks ADR-0014's language: `q` searches name and slug, and both are filterable on their own beside `kind` and `createdAt` — so a caller can ask "name contains" without also matching the slug. It omits soft-deleted rows unless the query mentions `deletedAt`, and `GET /:id` answers a soft-deleted organization `200` with its `deletedAt` set. Creating one names the owning account by id and answers `404 NOT_FOUND` for an id nothing holds. The memberships sub-resource adds a member **by user id**, and it is the one path that grants membership without an invitation; it answers `404` for an organization id nothing holds — on the list as well as the writes, nothing here having proved the organization exists. The last-owner and personal-organization refusals apply to staff exactly as to a member: adding a second member to a `personal` organization is `409 ORGANIZATION_PERSONAL_CLOSED` on this segment too.
Records: [ADR-0067](../adr/0067-organizations.md), [ADR-0019](../adr/0019-authorization-guards.md)
Proved by: `apps/api/test/organizations-admin.int.test.ts`

### Scenario: A manager writes

- **WHEN** a `manager` sends any write on `/api/v1/admin/organizations` or its memberships
- **THEN** the answer is `403 FORBIDDEN`, while every read on the same paths answers `200`

## Requirement: An impersonated session may not reshape a tenant

An impersonated session is refused, with `403 AUTH_IMPERSONATION_REFUSED`, the organization writes that would hand a third party the customer's tenant: changing a member's role, removing a member or leaving, deleting an organization, creating an invitation, and accepting one. Each of them succeeds on the account's own session. Editing an organization's name or slug is deliberately allowed and lands in the mutation trail with both identities, as every other permitted impersonated write does.
Records: [ADR-0067](../adr/0067-organizations.md), [ADR-0057](../adr/0057-impersonation-sessions.md), [ADR-0058](../adr/0058-append-only-audit-log.md)
Proved by: `apps/api/test/impersonation-exclusions.int.test.ts`

### Scenario: Support accepts an invitation on a customer's behalf

- **WHEN** an impersonated session posts to `/api/v1/user/invitations/:id/accept`
- **THEN** the answer is `403 AUTH_IMPERSONATION_REFUSED`, and the account's own session accepts it `200`
