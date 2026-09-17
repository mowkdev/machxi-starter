# Users and the profile

One aggregate, two views: `/api/v1/admin/users` is staff acting on a customer's account, and `/api/v1/user/profile` is a customer acting on their own. The admin view takes an id from the URL; the profile view takes none and reads the account from the session, which is what makes ownership structural rather than checked.

## Requirement: Managers read the customer base; admins change it

`/admin/users` mounts for `admin` and `manager`; every writing route — create, update, revoke sessions, set password, impersonate, delete — narrows to `admin`, and setting an address narrows further to `super_admin`. `super_admin` passes every check.
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

Every user resource on the admin segment carries the account's **`identities`** — `{ provider, email, linkedAt }`, read-only, empty for an account with none — and nothing about its password. `POST /admin/users` answers `201` with the resource; the address must be free among live accounts (`409 USER_EMAIL_TAKEN`), the role defaults to `customer`, the status to `active`, and the account's personal organization is created in the same transaction ([`organizations.md`](organizations.md)). `PATCH /admin/users/:id` changes names, status and roles in one transaction; a status leaving `active`, or a change to the role set, revokes every session of the account in the same commit.
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

`POST /admin/users/:id/password` takes the subject's new `password` and the acting staff member's `currentPassword`; the actor's password is verified first, before the subject is read, so a wrong one answers `403 AUTH_CURRENT_PASSWORD_INVALID` whether or not the id exists. On success every session of the subject is revoked, **every federated identity of the account is removed** with one `account.identity_unlinked { subjectType, subjectId, provider, via: "reset" }` row each naming the operator as actor, and the answer is `204`. The route is budgeted per **acting account**: beyond `RATE_LIMIT_PRINCIPAL_HASH_MAX` requests per `RATE_LIMIT_PRINCIPAL_HASH_WINDOW` it answers `429 RATE_LIMITED`, so the `403` cannot be used to guess the actor's own password without limit.
Records: [ADR-0027](../adr/0027-credential-self-service-and-reset.md), [ADR-0072](../adr/0072-federated-identity-google-sign-in.md), [ADR-0073](../adr/0073-review-hardening.md)
Proved by: `apps/api/test/users-admin.int.test.ts`, `apps/api/test/federated-identity.int.test.ts`, `apps/api/test/rate-limit.int.test.ts`

### Scenario: The actor's password is wrong

- **WHEN** an admin sets a password with a `currentPassword` that does not verify
- **THEN** the answer is `403 AUTH_CURRENT_PASSWORD_INVALID` and nothing changes

### Scenario: The reset lands

- **WHEN** the actor's password verifies
- **THEN** the subject can sign in with the new password, and their previous sessions answer `401 AUTH_SESSION_REVOKED` on refresh

### Scenario: The subject had linked Google

- **WHEN** the actor resets the password of an account with a Google identity
- **THEN** the answer is `204`, the identity is gone, and an `account.identity_unlinked` row names the account as its subject with `via: "reset"`

### Scenario: The actor keeps guessing

- **WHEN** one operator sends more than `RATE_LIMIT_PRINCIPAL_HASH_MAX` of these requests inside `RATE_LIMIT_PRINCIPAL_HASH_WINDOW`, whatever they answer
- **THEN** the next one answers `429 RATE_LIMITED` with `Retry-After`, and another operator from the same address is unaffected

## Requirement: A super admin sets a customer's address

`POST /admin/users/:id/email` takes the subject's new `email` and the acting operator's `currentPassword`, and admits `super_admin` alone — a plain `admin` answers `403 FORBIDDEN` at the guard. The actor's password is verified first, so a wrong one answers `403 AUTH_CURRENT_PASSWORD_INVALID` whether or not the id exists. The address is set immediately with no confirmation link and counts as **asserted**: `email_verified_at` is written with the address, stamped on any status but `pending_verification`, where it is cleared. The route carries the same per-acting-account budget as `POST /admin/users/:id/password`, for the same reason: beyond `RATE_LIMIT_PRINCIPAL_HASH_MAX` requests per `RATE_LIMIT_PRINCIPAL_HASH_WINDOW` it answers `429 RATE_LIMITED`, so its `403` is not an unbounded guess at the super admin's own password. An address a live account already holds — the subject's own included — answers `409 USER_EMAIL_TAKEN`; a soft-deleted subject answers `409 USER_DELETED`. Success answers `204`, writes an `account.email_changed` audit row naming the acting operator, the subject and both addresses, revokes no session, and **spends every live mailed link the account holds** — verification, recovery and a pending address change alike, because each was addressed to the mailbox being replaced.
Records: [ADR-0071](../adr/0071-mail-flows.md), [ADR-0027](../adr/0027-credential-self-service-and-reset.md), [ADR-0019](../adr/0019-authorization-guards.md), [ADR-0058](../adr/0058-append-only-audit-log.md), [ADR-0073](../adr/0073-review-hardening.md)
Proved by: `apps/api/test/users-admin.int.test.ts`, `apps/api/test/rate-limit.int.test.ts`

### Scenario: A plain admin tries

- **WHEN** an `admin` calls `POST /admin/users/:id/email`
- **THEN** the answer is `403 FORBIDDEN` and the address is unchanged

### Scenario: The address is set

- **WHEN** a `super_admin` sets a new address with their own password
- **THEN** the answer is `204`, the account signs in under the new address with `email_verified_at` stamped, and an `account.email_changed` row names both addresses with the operator as actor

### Scenario: The address is taken

- **WHEN** the new address is held by another live account, or is the one the subject already has
- **THEN** the answer is `409 USER_EMAIL_TAKEN` and nothing changes

### Scenario: A link was already in the old mailbox

- **WHEN** the account holds a live verification, recovery or address-change link and a `super_admin` sets a new address
- **THEN** every one of those links is spent, so none of them can act on the account afterwards

## Requirement: An admin delete is soft, and ends every session

`DELETE /admin/users/:id` sets `deletedAt` and `status: "disabled"`, revokes every session of the account, soft-deletes its personal organization and deletes its federated identities in the same transaction, and answers `204`. A second delete answers `409 USER_DELETED`. The row survives; the address becomes registrable again, and any Google account linked to it can sign in or link again. The organization half is stated in full by [`organizations.md`](organizations.md).
Records: [ADR-0028](../adr/0028-account-deletion.md), [ADR-0072](../adr/0072-federated-identity-google-sign-in.md)
Proved by: `apps/api/test/users-admin.int.test.ts`

### Scenario: Delete, then read

- **WHEN** an admin deletes an account and then reads it by id
- **THEN** the read answers `200` with `deletedAt` set and `status: "disabled"`

### Scenario: Delete twice

- **WHEN** the same account is deleted again
- **THEN** the answer is `409 USER_DELETED`

### Scenario: A linked Google account is released

- **WHEN** an admin deletes an account that has a Google identity linked
- **THEN** the identity is gone, and the same Google subject can be linked to another account

## Requirement: The profile is the caller's own, names only

`GET /user/profile` answers the caller's account; `PATCH /user/profile` accepts `firstName` and `lastName` (nullable) and nothing else — `status` and `roles` are unknown keys, so an account cannot re-enable or promote itself. A deleted account reaching either inside its token's lifetime answers `404 NOT_FOUND`. Both answer the shared resource plus **`hasPassword`**, a boolean — never the hash — and the resource's **`identities`**, the account's linked external identities as `{ provider, email, linkedAt }`; the provider's subject never leaves the API ([`federated-identity.md`](federated-identity.md)).
Records: [ADR-0019](../adr/0019-authorization-guards.md), [ADR-0055](../adr/0055-customer-app.md), [ADR-0072](../adr/0072-federated-identity-google-sign-in.md)
Proved by: `apps/api/test/user-profile.int.test.ts`

### Scenario: Which ways in the account has

- **WHEN** a customer with a password and one linked Google account reads their profile
- **THEN** the answer carries `hasPassword: true` and one identity `{ provider: "google", email, linkedAt }`, and no subject anywhere in the body

### Scenario: Promoting oneself

- **WHEN** a customer patches their profile with `roles` or `status`
- **THEN** the answer is `400 VALIDATION_ERROR` naming the key

## Requirement: Changing one's own password keeps this session and ends the others

`POST /user/profile/change-password` takes `currentPassword` and `newPassword`, which must differ; the current password must verify (`403 AUTH_CURRENT_PASSWORD_INVALID`), an account with no password cannot use it, and on success every other session of the account is revoked while the caller's own survives. The account's federated identities are **kept** — the change was made with the account's own authority. `204`. This route, `DELETE /user/profile`, `DELETE /user/profile/identities/:provider` and `POST /user/profile/change-email` share one budget of `RATE_LIMIT_PRINCIPAL_HASH_MAX` per `RATE_LIMIT_PRINCIPAL_HASH_WINDOW` keyed on the **calling account**; beyond it they answer `429 RATE_LIMITED`.
Records: [ADR-0027](../adr/0027-credential-self-service-and-reset.md), [ADR-0072](../adr/0072-federated-identity-google-sign-in.md), [ADR-0073](../adr/0073-review-hardening.md)
Proved by: `apps/api/test/user-profile.int.test.ts`, `apps/api/test/federated-identity.int.test.ts`, `apps/api/test/rate-limit.int.test.ts`

### Scenario: Two devices

- **WHEN** an account signed in on two devices changes its password from one
- **THEN** that device keeps working and the other's next refresh answers `401 AUTH_SESSION_REVOKED`

### Scenario: The budget is one counter, not three

- **WHEN** one account spends its budget on `change-password` and then calls `DELETE /user/profile` or `change-email`
- **THEN** that request answers `429 RATE_LIMITED` on the strength of requests it never saw

## Requirement: An account may close itself, with its password

`DELETE /user/profile` takes `{ currentPassword }`, verifies it before writing, then soft-deletes the account and its personal organization, deletes its federated identities, revokes every session — the caller's included — clears the user population's cookies, and answers `204`. A second attempt answers `404 NOT_FOUND`: the self view no longer sees the account.
Records: [ADR-0055](../adr/0055-customer-app.md), [ADR-0028](../adr/0028-account-deletion.md), [ADR-0027](../adr/0027-credential-self-service-and-reset.md), [ADR-0072](../adr/0072-federated-identity-google-sign-in.md)
Proved by: `apps/api/test/user-profile.int.test.ts`

### Scenario: Wrong password

- **WHEN** the presented password does not verify
- **THEN** the answer is `403 AUTH_CURRENT_PASSWORD_INVALID` and the account is untouched

### Scenario: The account closes

- **WHEN** the password verifies
- **THEN** the answer is `204`, the refresh token that made the request is dead, and the address can be registered again
