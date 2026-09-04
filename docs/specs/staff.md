# Staff

Operators are created by an admin, never by themselves. `/api/v1/admin/staff` is `admin`-only throughout; `/api/v1/admin/profile` is every operator acting on their own account. The `super_admin` role bypasses every role check, so what protects it is the service's rules rather than a guard.

## Requirement: The resource is admin-only

`/admin/staff` mounts `authorize("admin")` and every route inherits it; a `manager` or `editor` reaches nothing under it.
Records: [ADR-0019](../adr/0019-authorization-guards.md)
Proved by: `apps/api/test/staff-admin.int.test.ts`, `apps/api/src/core/middleware/__tests__/authorize.test.ts`

### Scenario: A manager lists staff

- **WHEN** a `manager` calls `GET /admin/staff`
- **THEN** the answer is `403 FORBIDDEN`

## Requirement: Creating an operator

`POST /admin/staff` takes email, password, both names and at least one role, creates the account `active`, and answers `201`. A taken address answers `409 STAFF_EMAIL_TAKEN`. Emails are unique within staff, not across populations.
Records: [ADR-0018](../adr/0018-authentication-sessions-and-tokens.md), [ADR-0017](../adr/0017-identity-model-populations-and-roles.md)
Proved by: `apps/api/test/staff-admin.int.test.ts`

### Scenario: No role

- **WHEN** the body carries `roles: []`
- **THEN** the answer is `400 VALIDATION_ERROR`

### Scenario: The same address as a customer

- **WHEN** the address belongs to a user account and to no staff account
- **THEN** the answer is `201`

## Requirement: Only a super admin touches the super admin role or its holders

Granting or revoking `super_admin` through `PATCH /admin/staff/:id` is refused unless the caller is a `super_admin`; so are disabling a super admin and revoking their sessions. Re-sending a role set that already contains the role, or editing a super admin's names, is not an escalation and is allowed. The refusal is `403 FORBIDDEN`.
Records: [ADR-0017](../adr/0017-identity-model-populations-and-roles.md)
Proved by: `apps/api/test/staff-admin.int.test.ts`, `apps/api/src/modules/staff/__tests__/staff.service.test.ts`

### Scenario: An admin promotes themselves

- **WHEN** an `admin` patches their own roles to include `super_admin`
- **THEN** the answer is `403 FORBIDDEN`

### Scenario: An admin disables a super admin

- **WHEN** an `admin` patches a super admin to `disabled`, or calls `POST /:id/sessions/revoke` on them
- **THEN** the answer is `403 FORBIDDEN`

## Requirement: The last active super admin survives

Disabling, demoting or deleting the only remaining active `super_admin` answers `409 STAFF_LAST_SUPER_ADMIN`. The count is taken under a transaction-scoped lock, so two concurrent requests cannot each see the other as the survivor.
Records: [ADR-0017](../adr/0017-identity-model-populations-and-roles.md), [ADR-0028](../adr/0028-account-deletion.md)
Proved by: `apps/api/test/staff-admin.int.test.ts`, `apps/api/test/staff-delete.int.test.ts`

### Scenario: Demoting the last one

- **WHEN** a super admin removes `super_admin` from the only active holder — themselves
- **THEN** the answer is `409 STAFF_LAST_SUPER_ADMIN`

## Requirement: A role change ends the subject's sessions

`PATCH /admin/staff/:id` with a role set that differs from the current one revokes every session of the subject in the same transaction, with reason `roles_changed`; a status leaving `active` does the same with `account_disabled`. Re-sending the same set revokes nothing.
Records: [ADR-0017](../adr/0017-identity-model-populations-and-roles.md), [ADR-0018](../adr/0018-authentication-sessions-and-tokens.md)
Proved by: `apps/api/test/staff-admin.int.test.ts`

### Scenario: Demoted while signed in

- **WHEN** an admin's roles are changed while they hold a session
- **THEN** their next refresh answers `401 AUTH_SESSION_REVOKED`

## Requirement: A staff delete is hard, and never one's own

`DELETE /admin/staff/:id` removes the row and its role grants, revokes its sessions in the same transaction, and answers `204`. Deleting oneself answers `403 FORBIDDEN`; deleting the last active super admin answers `409 STAFF_LAST_SUPER_ADMIN`; an unknown id answers `404 NOT_FOUND`.
Records: [ADR-0028](../adr/0028-account-deletion.md)
Proved by: `apps/api/test/staff-delete.int.test.ts`

### Scenario: Self-deletion

- **WHEN** an admin calls `DELETE` on their own id, in any letter case
- **THEN** the answer is `403 FORBIDDEN`

### Scenario: Delete, then read

- **WHEN** a deleted operator is read by id
- **THEN** the answer is `404 NOT_FOUND` — the row is gone

## Requirement: Staff set a colleague's password with their own

`POST /admin/staff/:id/password` verifies the caller's `currentPassword` first, then sets the subject's password and revokes every session of the subject. `204`.
Records: [ADR-0027](../adr/0027-credential-self-service-and-reset.md)
Proved by: `apps/api/test/staff-admin.int.test.ts`

### Scenario: Wrong own password

- **WHEN** the caller's `currentPassword` does not verify
- **THEN** the answer is `403 AUTH_CURRENT_PASSWORD_INVALID`, the same whether or not `:id` exists

## Requirement: The profile is names only, and the password change spares this session

`GET /admin/profile` and `PATCH /admin/profile` (names, non-nullable) address the caller's own account without an id; `POST /admin/profile/change-password` requires the current password, refuses an unchanged one, and revokes every other session of the caller.
Records: [ADR-0027](../adr/0027-credential-self-service-and-reset.md), [ADR-0019](../adr/0019-authorization-guards.md)
Proved by: `apps/api/test/staff-profile.int.test.ts`

### Scenario: An editor changes their own password

- **WHEN** an `editor` — who cannot reach `/admin/staff` — calls `change-password` with a verifying current password
- **THEN** the answer is `204`
