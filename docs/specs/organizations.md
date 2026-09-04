# Organizations

Every user belongs to organizations; each membership carries a role; staff are above all of them. What has shipped so far is the model and its data invariants — the tables, the migration that backfills them and the seeds. The HTTP surface, the membership guard and the customer app's switcher follow with the deliverable in progress, and this file grows a requirement per route as each lands.

## Requirement: Every live user has exactly one personal organization

A user account always owns a `personal` organization with an `owner` membership: the migration that created the tables backfilled one for every existing live account, and the dev seeds create one per fixture user. Both are idempotent — a second run changes no row. A team organization (`acme` in the dev fixtures) has an owner and members like any other.
Records: [ADR-0067](../adr/0067-organizations.md)
Proved by: `packages/db/src/__tests__/seeds.int.test.ts`

### Scenario: After the seeds

- **WHEN** `pnpm db:seed -- --dev` has run against a database with no organizations
- **THEN** every live user has one `personal` organization it owns, and running the seeds again leaves every count unchanged

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
