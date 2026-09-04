# Organizations

Every user belongs to organizations; each membership carries a role; staff are above all of them. What has shipped so far is the model with its data invariants and the personal organization's lifecycle on every path that creates or closes an account. The organization-scoped routes and the customer app's switcher follow with the deliverable in progress, and this file grows a requirement per route as each lands.

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
Records: [ADR-0067](../adr/0067-organizations.md), [ADR-0019](../adr/0019-authorization-guards.md)
Proved by: `apps/api/src/modules/organizations/__tests__/require-membership.test.ts`

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
