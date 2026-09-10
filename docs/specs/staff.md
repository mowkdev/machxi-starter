# Staff

Operators are created by an admin, never by themselves. `/api/v1/admin/staff` is `admin`-only throughout, but for one route that narrows to `super_admin`; `/api/v1/admin/profile` is every operator acting on their own account. The `super_admin` role bypasses every role check, so what protects it is the service's rules rather than a guard.

## Requirement: The resource is admin-only

`/admin/staff` mounts `authorize("admin")` and every route inherits it; a `manager` or `editor` reaches nothing under it. One route narrows further — `POST /:id/email` admits `super_admin` alone. `POST /:id/onboarding/resend` carries no guard of its own and is therefore `admin`, like the mount.
Records: [ADR-0019](../adr/0019-authorization-guards.md)
Proved by: `apps/api/test/staff-admin.int.test.ts`, `apps/api/src/core/middleware/__tests__/authorize.test.ts`

### Scenario: A manager lists staff

- **WHEN** a `manager` calls `GET /admin/staff`
- **THEN** the answer is `403 FORBIDDEN`

## Requirement: Creating an operator

`POST /admin/staff` takes email, both names, at least one role and — optionally — a password. With one, the account is created `active` and answers `201`; without one it is created `invited` with no password at all, and an onboarding link is mailed to the address. A taken address answers `409 STAFF_EMAIL_TAKEN`. Emails are unique within staff, not across populations.
Records: [ADR-0018](../adr/0018-authentication-sessions-and-tokens.md), [ADR-0017](../adr/0017-identity-model-populations-and-roles.md), [ADR-0071](../adr/0071-mail-flows.md)
Proved by: `apps/api/test/staff-admin.int.test.ts`, `apps/api/src/modules/staff/__tests__/staff.service.test.ts`

### Scenario: No role

- **WHEN** the body carries `roles: []`
- **THEN** the answer is `400 VALIDATION_ERROR`

### Scenario: The same address as a customer

- **WHEN** the address belongs to a user account and to no staff account
- **THEN** the answer is `201`

### Scenario: Created with a password

- **WHEN** the body carries a password
- **THEN** the account is `active`, nothing is mailed, and the operator signs in with that password straight away

### Scenario: Created without one

- **WHEN** the body carries no `password` at all
- **THEN** the account is `invited`, one message goes to the address carrying `#token=…` on a link into the **admin** app, and the row has no password hash

## Requirement: An invited operator sets their own password from the link

`POST /admin/auth/onboarding/accept { token, password }` consumes the link, writes the operator's first password, moves the row to `active`, writes an `account.onboarded` audit row and answers `200` with login's body on whichever transport the caller asked for — the device that opened the invitation is signed in. Every refusal is one indistinguishable `401 UNAUTHENTICATED`, and a refused consumption spends nothing. The route is registered on the admin segment alone. `POST /admin/staff/:id/onboarding/resend` re-mints and re-sends for an `invited` row, retiring the previous link; any other status answers `409 STAFF_NOT_INVITED` and an unknown id `404 NOT_FOUND`.
Records: [ADR-0071](../adr/0071-mail-flows.md), [ADR-0017](../adr/0017-identity-model-populations-and-roles.md), [ADR-0058](../adr/0058-append-only-audit-log.md)
Proved by: `apps/api/test/staff-admin.int.test.ts`, `apps/api/src/modules/staff/__tests__/staff.service.test.ts`

### Scenario: Signing in before the link is followed

- **WHEN** any password is presented at login for an `invited` account
- **THEN** the answer is `401 AUTH_INVALID_CREDENTIALS` — there is no password on the row to be right about, so the account is indistinguishable from an address nobody holds

### Scenario: Following the link

- **WHEN** the token from the message is posted to `onboarding/accept` with a chosen password
- **THEN** the answer is `200` with login's body, the account is `active`, and that password signs in at `/admin/auth/login`

### Scenario: Following it twice

- **WHEN** the same token is posted again
- **THEN** the answer is `401 UNAUTHENTICATED` and the password stays as the first accept left it

### Scenario: A token of another purpose

- **WHEN** a staff password-reset token is posted to `onboarding/accept`
- **THEN** the answer is `401 UNAUTHENTICATED`

### Scenario: The other segment

- **WHEN** an authenticated customer posts to `/user/auth/onboarding/accept`
- **THEN** the answer is `404 ROUTE_NOT_FOUND` — the route exists on the admin segment only

### Scenario: A live link whose account was disabled since the mint

- **WHEN** an admin disables the invited row and the link is then followed
- **THEN** the answer is `401 UNAUTHENTICATED` and the token's `consumed_at` is still null, so the link works again once the row is `invited` once more

### Scenario: Asking for the link again

- **WHEN** an admin calls `onboarding/resend` on the invited row
- **THEN** the answer is `204`, a new message is sent, and the previous link answers `401 UNAUTHENTICATED` while the new one works

### Scenario: Asking for it for somebody who has already joined

- **WHEN** `onboarding/resend` names an `active` operator
- **THEN** the answer is `409 STAFF_NOT_INVITED` and nothing is sent

## Requirement: An operator waiting on their invitation is not given a password by anybody else

While a staff row has no password hash, the invitation link is the only thing that may write one. `POST /admin/staff/:id/password` on an `invited` operator answers `409 STAFF_INVITATION_PENDING` and writes nothing — there is no credential to replace, and one written there could not be used, because the row would still be `invited`. `PATCH /admin/staff/:id { status: "active" }` on any row with no password hash answers the same `409`: an operator is made `active` by following their link, and an `active` row nobody can sign in as would still be counted by the last-super-admin invariant. Every other status still moves, including back to `invited`.
Records: [ADR-0071](../adr/0071-mail-flows.md), [ADR-0027](../adr/0027-credential-self-service-and-reset.md), [ADR-0017](../adr/0017-identity-model-populations-and-roles.md)
Proved by: `apps/api/test/staff-admin.int.test.ts`, `apps/api/src/modules/staff/__tests__/staff.service.test.ts`

### Scenario: Setting a password for somebody who has not joined

- **WHEN** an admin calls `POST /:id/password` on an `invited` operator
- **THEN** the answer is `409 STAFF_INVITATION_PENDING`, the row keeps its null hash, and the invitation link still works

### Scenario: Activating them by hand instead

- **WHEN** an admin patches that operator to `status: "active"`
- **THEN** the answer is `409 STAFF_INVITATION_PENDING` — and the same refusal applies to a `disabled` operator who never had a password, because what is refused is `active` with nothing to sign in with

### Scenario: Any other status

- **WHEN** the same operator is patched to `disabled`, and back to `invited`
- **THEN** both answer `200` — the refusal is a pairing, not a transition

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

## Requirement: A super admin sets an operator's address

`POST /admin/staff/:id/email` is the one route under `/admin/staff` that narrows the mount's guard: it admits `super_admin` alone, so a plain `admin` answers `403 FORBIDDEN`. It takes the subject's new `email` and the acting operator's own `currentPassword`, verified first — a wrong one answers `403 AUTH_CURRENT_PASSWORD_INVALID` whether or not `:id` exists. The address is set immediately with no confirmation link, because the operator is the authority a link would be asking. An address any staff account already holds — the subject's own included — answers `409 STAFF_EMAIL_TAKEN`. Success answers `204`, writes an `account.email_changed` audit row naming the acting operator, the subject and both addresses, spends every live mailed link the operator holds — recovery and onboarding alike, because each was addressed to the mailbox being replaced — and revokes **no** session: an address is not a credential. A super admin may name their own id.
Records: [ADR-0071](../adr/0071-mail-flows.md), [ADR-0027](../adr/0027-credential-self-service-and-reset.md), [ADR-0019](../adr/0019-authorization-guards.md), [ADR-0058](../adr/0058-append-only-audit-log.md)
Proved by: `apps/api/test/staff-admin.int.test.ts`

### Scenario: A plain admin tries

- **WHEN** an `admin` calls `POST /admin/staff/:id/email`
- **THEN** the answer is `403 FORBIDDEN` and the address is unchanged

### Scenario: The address is set

- **WHEN** a `super_admin` sets a new address with their own password
- **THEN** the answer is `204`, the operator signs in under the new address, and their existing sessions still work

## Requirement: The profile is names only, and the password change spares this session

`GET /admin/profile` and `PATCH /admin/profile` (names, non-nullable) address the caller's own account without an id; `POST /admin/profile/change-password` requires the current password, refuses an unchanged one, and revokes every other session of the caller.
Records: [ADR-0027](../adr/0027-credential-self-service-and-reset.md), [ADR-0019](../adr/0019-authorization-guards.md)
Proved by: `apps/api/test/staff-profile.int.test.ts`

### Scenario: An editor changes their own password

- **WHEN** an `editor` — who cannot reach `/admin/staff` — calls `change-password` with a verifying current password
- **THEN** the answer is `204`
