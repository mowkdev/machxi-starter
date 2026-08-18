# ADR-0017: Identity model — two populations (staff, users) with roles

- Status: accepted
- Date: 2026-08-17

## Context

The system serves two distinct populations: **staff** (internal operators using the admin panel — super admin, admin, manager, editor, …) and **users** (external customers using web/mobile — customer, plus future roles such as premium, vendor…). They authenticate separately (ADR-0018), use separate route segments (ADR-0015), have different lifecycles and different attributes, and must never be confused (a staff token must not work on user routes and vice versa). Roles are per population and an account may hold several.

## Decision

### Separate tables per population

Populations are **separate aggregates with separate tables**, not a single `accounts` table with a `type` column:

```
staff                    users
-----                    -----
id uuid pk               id uuid pk
email citext unique      email citext unique
password_hash text       password_hash text (nullable — future social/passwordless)
first_name, last_name    first_name, last_name (nullable)
status enum              status enum
last_login_at            last_login_at
created_at, updated_at   created_at, updated_at, deleted_at

staff_roles              user_roles
-----------              ----------
staff_id fk              user_id fk
role staff_role enum     role user_role enum
granted_at, granted_by   granted_at
pk (staff_id, role)      pk (user_id, role)
```

- `status`: `active | invited | disabled` for staff; `active | pending_verification | disabled` for users (enum per table).
- `email` is `citext` (case-insensitive unique).
- Roles are Postgres enums to start (`staff_role: super_admin | admin | manager | editor`, `user_role: customer`), mirrored as unions in `@repo/contracts`. Adding a role = migration adding an enum value (`ALTER TYPE … ADD VALUE`) + contracts update. A `roles` reference table with permissions comes with the fine-grained permissions ADR later; the enum keeps v1 simple and the join tables already give many-to-many.
- Sessions reference **either** a staff or a user via a `principal_type` discriminator + `principal_id` (ADR-0018), so one sessions table serves both without a polymorphic FK mess (indexes on `(principal_type, principal_id)`).

### Principal abstraction in code

`Principal` (ADR-0010) is a discriminated union on `kind: 'staff' | 'user'`. Auth and guards are generic over population via a small `PrincipalAdapter` type (`{ findByEmail, findById, rolesOf, isActive }`) produced by `staffPrincipalAdapter(staffRepo)` and `userPrincipalAdapter(usersRepo)`, so `createAuthService` is written once and called per population (`createAuthService({ population: 'staff', principals: staffPrincipalAdapter(staffRepo), … })`, likewise for `'user'`).

**Amended 2026-08-18 (implementation step 8).** The adapter that shipped differs
from the `{ findByEmail, findById, rolesOf, isActive }` sketch above in three
ways, each because the sketch would have cost a query or a cast:

- **`rolesOf` and `isActive` are folded into the record.** `findByEmail` and
  `findById` return a `PrincipalRecord` that already carries `roles` (loaded in
  the same query, via the join) and `active: boolean`. Calling `rolesOf` after
  `findByEmail` would be a second round trip on the login path for data the
  first query can return; and `active` rather than the raw `status` keeps "which
  enum values count as active" inside the adapter, where the two populations'
  enums differ. The repositories do not carry a standalone `rolesOf` either —
  step 9 adds the role queries its own endpoints need, rather than this step
  leaving an unused one behind.
- **The record carries its own wire resource.** Staff names are `not null` and
  user names are nullable, so one flat record cannot type both; each adapter
  maps its row with its own mapper and puts the `PrincipalResource` on the
  record. That is what lets `createAuthService` be non-generic.
- **`create` is optional and absent on the staff adapter.** "Staff cannot
  self-register" is an invariant, not a missing feature, so it is expressed by
  the adapter having no such function rather than by a runtime flag. The public
  register route is mounted from the user service only.

### Roles vs. permissions

- **v1**: role-based guards only (`authorize('admin','manager')`, ADR-0019). `super_admin` implicitly passes every staff role check.
- **Later**: permission strings (`users:read`, `users:write`) resolved from roles; guards accept permissions; roles become data. The `authorize` API is designed so this is additive.

### Invariants

- At least one `super_admin` must exist; the seed creates it (ADR-0008); disabling/removing the last one is refused by the service.
- Staff cannot self-register; they are invited/created by an admin. Users may self-register if the project enables `/public/auth/register`.
- Emails are unique within a population, not across (the same person may be both a staff member and a user).

## Consequences

- No accidental cross-population access: different tables, different `Principal.kind`, different token audience (ADR-0018).
- Attributes diverge freely (staff get `department`, users get `marketingOptIn`) without nullable columns polluting the other.
- Two similar CRUD modules (`staff`, `users`); shared logic factored into the generic auth service and adapters, not into a shared table.

## Alternatives considered

- Single `accounts` table + `type` column: fewer tables, but leaks attributes across populations, complicates constraints, and makes it easy to authorise the wrong population.
- Roles as free-text strings: no integrity; enum + contracts union is safer.
- Full RBAC tables (roles, permissions, role_permissions) now: premature for the first deliverable; path is reserved.
