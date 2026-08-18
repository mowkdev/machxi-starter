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

**Amended 2026-08-18 (step 9).** The list above had one invariant about
`super_admin` — that the last one survives — and that turned out to be the
weaker half of what the role needs. `super_admin` bypasses every staff role
check (ADR-0019), which means the only guard standing between an `admin` and
that bypass is what the staff service refuses. Two rules are added, both
enforced in `staff.service.ts` and both plain `403 FORBIDDEN` — the caller is
authenticated and simply lacks the standing:

- **Only a `super_admin` may grant or revoke `super_admin`.** `authorize("admin")`
  is what lets a caller reach `PATCH /api/v1/admin/staff/:id`, and their own id
  is a legal `:id`, so without this the role is self-service. Only a _change_ to
  membership is refused; re-sending a set that already contains it, or editing a
  super admin's profile, is not an escalation. The check runs **before** the
  last-super-admin check: "you may not do this at all" outranks "nobody may do
  this right now".
- **Only a `super_admin` may disable or sign out a `super_admin`.** Protecting
  the role without protecting its holder left the hierarchy inverted from below:
  an `admin` could not take the role away, but could set its holder to
  `disabled` (legal for any super admin but the last) or call
  `POST /:id/sessions/revoke` on them in a loop and keep them permanently signed
  out. A privilege that everyone it outranks can neutralise is not a privilege.
  Only actions that _remove_ standing are refused — renaming and re-activating
  are not.

The general form of the second rule — "a target that outranks you is protected
from you" — will also cover password reset and deletion when those arrive, and
belongs here rather than being restated in each service.

**Every role write ends the subject's sessions.** Roles ride in the access
token's claims and are not re-read per request (ADR-0018, ADR-0019 §Rules),
which was harmless while roles were immutable at runtime. Once they are
editable, a demotion that leaves the sessions alive does not take effect for up
to `JWT_ACCESS_TTL` — long enough for its subject to call the same endpoint and
put the role back, indefinitely. So a `PATCH` that changes the role _set_
revokes that account's sessions inside the same transaction, with reason
`roles_changed`. Re-sending an unchanged set does not. This is the cheaper of
the two available fixes; the other, a `roles_version` claim compared per
request, stays available if per-request freshness is ever needed for something
other than roles.

**Serialising the invariant.** "At least one active `super_admin` must exist" is
checked by counting the _other_ super admins, and under the default READ
COMMITTED isolation a count cannot see an uncommitted sibling: two concurrent
requests disabling two different super admins each count the other as the
survivor, and both commit. Row locks do not help, because the two transactions
touch different rows and never conflict. `staff.repository.lockRoleInvariant`
therefore takes a transaction-scoped advisory lock at the top of every staff
update, before the read the decision rests on. It is a whole-table gate on staff
edits, which is affordable precisely because a handful of operators use them.

## Consequences

- No accidental cross-population access: different tables, different `Principal.kind`, different token audience (ADR-0018).
- Attributes diverge freely (staff get `department`, users get `marketingOptIn`) without nullable columns polluting the other.
- Two similar CRUD modules (`staff`, `users`); shared logic factored into the generic auth service and adapters, not into a shared table.

## Alternatives considered

- Single `accounts` table + `type` column: fewer tables, but leaks attributes across populations, complicates constraints, and makes it easy to authorise the wrong population.
- Roles as free-text strings: no integrity; enum + contracts union is safer.
- Full RBAC tables (roles, permissions, role_permissions) now: premature for the first deliverable; path is reserved.
