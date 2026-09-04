# Users and the profile

One aggregate, two views: `/api/v1/admin/users` is staff acting on a customer's account, and `/api/v1/user/profile` is a customer acting on their own. The admin view takes an id from the URL; the profile view takes none and reads the account from the session, which is what makes ownership structural rather than checked.

## Requirement: Managers read the customer base; admins change it

`/admin/users` mounts for `admin` and `manager`; every writing route — create, update, revoke sessions, set password, impersonate, delete — narrows to `admin`. `super_admin` passes every check.
Records: [ADR-0019](../adr/0019-authorization-guards.md), [ADR-0017](../adr/0017-identity-model-populations-and-roles.md)
Proved by: `apps/api/test/users-admin.int.test.ts`, `apps/api/src/core/middleware/__tests__/authorize.test.ts`

### Scenario: A manager writes

- **WHEN** a `manager` calls `POST /admin/users` or `PATCH /admin/users/:id`
- **THEN** the answer is `403 FORBIDDEN`

### Scenario: An editor reads

- **WHEN** an `editor` calls `GET /admin/users`
- **THEN** the answer is `403 FORBIDDEN`

## Requirement: A soft-deleted account is hidden unless asked about, and readable by id

`GET /admin/users` omits soft-deleted rows unless the query mentions `deletedAt`, in which case the filter alone decides; `GET /admin/users/:id` answers a deleted account with `200` and its `deletedAt` set, because an admin who can list one must be able to open it. Every write aimed at a deleted account answers `409 USER_DELETED`.
Records: [ADR-0028](../adr/0028-account-deletion.md), [ADR-0014](../adr/0014-pagination-filtering-sorting.md)
Proved by: `apps/api/test/users-admin.int.test.ts`

### Scenario: Deleted only

- **WHEN** a staff member lists with `filter[deletedAt][null]=false`
- **THEN** the page holds only deleted accounts — the default scope steps aside rather than combining

### Scenario: Writing to a deleted account

- **WHEN** `PATCH`, `POST /:id/password` or `POST /:id/sessions/revoke` targets a deleted account
- **THEN** the answer is `409 USER_DELETED`

## Requirement: Creating and updating an account

`POST /admin/users` answers `201` with the resource; the address must be free among live accounts (`409 USER_EMAIL_TAKEN`), the role defaults to `customer` and the status to `active`. `PATCH /admin/users/:id` changes names, status and roles in one transaction; a status leaving `active`, or a change to the role set, revokes every session of the account in the same commit.
Records: [ADR-0017](../adr/0017-identity-model-populations-and-roles.md), [ADR-0018](../adr/0018-authentication-sessions-and-tokens.md), [ADR-0028](../adr/0028-account-deletion.md)
Proved by: `apps/api/test/users-admin.int.test.ts`, `apps/api/src/modules/users/__tests__/users.service.test.ts`

### Scenario: A taken address

- **WHEN** an admin creates an account with an address a live account holds
- **THEN** the answer is `409 USER_EMAIL_TAKEN`

### Scenario: A released address

- **WHEN** an admin creates an account with an address only a deleted account holds
- **THEN** the answer is `201` — deletion released the address

### Scenario: Disabling a signed-in account

- **WHEN** an admin patches a signed-in account to `disabled`
- **THEN** the answer is `200`, and the account's next refresh answers `401 AUTH_SESSION_REVOKED`

### Scenario: Clearing a name

- **WHEN** the patch carries `firstName: null`
- **THEN** the name is cleared; `undefined` leaves it alone

## Requirement: Staff set a customer's password with their own

`POST /admin/users/:id/password` takes the subject's new `password` and the acting staff member's `currentPassword`; the actor's password is verified first, before the subject is read, so a wrong one answers `403 AUTH_CURRENT_PASSWORD_INVALID` whether or not the id exists. On success every session of the subject is revoked and the answer is `204`.
Records: [ADR-0027](../adr/0027-credential-self-service-and-reset.md)
Proved by: `apps/api/test/users-admin.int.test.ts`

### Scenario: The actor's password is wrong

- **WHEN** an admin sets a password with a `currentPassword` that does not verify
- **THEN** the answer is `403 AUTH_CURRENT_PASSWORD_INVALID` and nothing changes

### Scenario: The reset lands

- **WHEN** the actor's password verifies
- **THEN** the subject can sign in with the new password, and their previous sessions answer `401 AUTH_SESSION_REVOKED` on refresh

## Requirement: An admin delete is soft, and ends every session

`DELETE /admin/users/:id` sets `deletedAt` and `status: "disabled"`, revokes every session of the account in the same transaction, and answers `204`. A second delete answers `409 USER_DELETED`. The row survives; the address becomes registrable again.
Records: [ADR-0028](../adr/0028-account-deletion.md)
Proved by: `apps/api/test/users-admin.int.test.ts`

### Scenario: Delete, then read

- **WHEN** an admin deletes an account and then reads it by id
- **THEN** the read answers `200` with `deletedAt` set and `status: "disabled"`

### Scenario: Delete twice

- **WHEN** the same account is deleted again
- **THEN** the answer is `409 USER_DELETED`

## Requirement: The profile is the caller's own, names only

`GET /user/profile` answers the caller's account; `PATCH /user/profile` accepts `firstName` and `lastName` (nullable) and nothing else — `status` and `roles` are unknown keys, so an account cannot re-enable or promote itself. A deleted account reaching either inside its token's lifetime answers `404 NOT_FOUND`.
Records: [ADR-0019](../adr/0019-authorization-guards.md), [ADR-0055](../adr/0055-customer-app.md)
Proved by: `apps/api/test/user-profile.int.test.ts`

### Scenario: Promoting oneself

- **WHEN** a customer patches their profile with `roles` or `status`
- **THEN** the answer is `400 VALIDATION_ERROR` naming the key

## Requirement: Changing one's own password keeps this session and ends the others

`POST /user/profile/change-password` takes `currentPassword` and `newPassword`, which must differ; the current password must verify (`403 AUTH_CURRENT_PASSWORD_INVALID`), an account with no password cannot use it, and on success every other session of the account is revoked while the caller's own survives. `204`.
Records: [ADR-0027](../adr/0027-credential-self-service-and-reset.md)
Proved by: `apps/api/test/user-profile.int.test.ts`

### Scenario: Two devices

- **WHEN** an account signed in on two devices changes its password from one
- **THEN** that device keeps working and the other's next refresh answers `401 AUTH_SESSION_REVOKED`

## Requirement: An account may close itself, with its password

`DELETE /user/profile` takes `{ currentPassword }`, verifies it before writing, then soft-deletes the account, revokes every session — the caller's included — clears the user population's cookies, and answers `204`. A second attempt answers `404 NOT_FOUND`: the self view no longer sees the account.
Records: [ADR-0055](../adr/0055-customer-app.md), [ADR-0028](../adr/0028-account-deletion.md), [ADR-0027](../adr/0027-credential-self-service-and-reset.md)
Proved by: `apps/api/test/user-profile.int.test.ts`

### Scenario: Wrong password

- **WHEN** the presented password does not verify
- **THEN** the answer is `403 AUTH_CURRENT_PASSWORD_INVALID` and the account is untouched

### Scenario: The account closes

- **WHEN** the password verifies
- **THEN** the answer is `204`, the refresh token that made the request is dead, and the address can be registered again
