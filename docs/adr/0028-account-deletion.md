# ADR-0028: Account deletion: soft for users, hard for staff

- Status: accepted
- Date: 2026-08-18

## Context

D1 built the whole read half of soft deletion and none of the write half.

`users.deleted_at` exists ([ADR-0006](0006-database-postgres-drizzle.md): "soft delete only where the domain needs it… not applied by default"). The users repository carries `findById` and `findAnyById` — the self view excludes soft-deleted rows, the admin view includes them. `list` steps its default `deleted_at is null` scope aside as soon as the query mentions the field, so `filter[deletedAt][null]=false` can return something. `deletedAt` rides on `UserResource`, added during D1.9's review because `USER_STATUSES` has no `deleted` member and without the field a deleted account rendered exactly like a live one. There is an integration test, and there is a Postman request.

Nothing in the API can set the column. The integration test writes it with raw Drizzle and says so:

> `// No endpoint sets it: soft deletion arrives with the delete endpoint, and the read path it changes exists now.`

Building the read path first is defensible — it is the half that shapes the module — but it leaves two questions unanswered, and both become live bugs on the day a delete endpoint lands rather than gradually:

- **`users.email` carries a plain unique constraint**, and `create` uses `onConflictDoNothing({ target: users.email })`. A soft-deleted address is therefore burned permanently: re-registration answers a generic `CONFLICT` (ADR-0018 §Staff onboarding, amended), the account cannot be revived through any endpoint, and support has no answer for "I deleted my account and want to come back".
- **`PATCH /api/v1/admin/users/:id` reads through `readAny`**, which includes soft-deleted rows. An admin can therefore set a soft-deleted account back to `active` without clearing `deleted_at`, producing a row that is simultaneously active and deleted — a state no reader is written to expect.

[ADR-0017](0017-identity-model-populations-and-roles.md) §Invariants anticipated the decision and deferred it: its rank rule "will also cover password reset and deletion when those arrive". Deletion is arriving.

The populations are not symmetric here and should not be made so. The `users` schema already records why: a customer record is referenced by future order history, while a staff member is a directory entry that can be removed outright. `staff` has no `deleted_at` column and this ADR does not add one.

## Decision

### Users — soft delete

```
DELETE /api/v1/admin/users/:id    (role admin)   → 204
```

One transaction, three writes:

1. `deleted_at = now()`
2. `status = 'disabled'`
3. every live session of the account revoked, reason `account_deleted`

**Why `status` is written too**, when `deleted_at` alone already stops sign-in (`findByEmail` filters `deleted_at is null`): so that `status` stays a truthful column on its own. `filter[status][eq]=active` is an allow-listed filter on the admin list, and an account that is active-and-deleted would satisfy it. The alternative — adding a `deleted` member to `USER_STATUSES` — was already declined during D1.9, which is exactly why `deletedAt` is on the wire; reversing that here would put the same fact in two places and make the enum's declaration order (which is its SQL sort order, ADR-0017) carry a value that is not a status.

**Sessions are revoked in the same transaction** because `sessions` has no foreign key to either population (ADR-0018), so nothing else does it, and a gap between the two writes is a window in which a deleted account still holds a valid access token.

### Users — the email is released

A migration replaces the unqualified unique constraint on `users.email` with a **partial unique index**:

```sql
create unique index users_email_active_unique on users (email) where deleted_at is null;
```

A deleted address becomes available again, and a person who deletes their account can register with the same address later. Two rows may then share an address, at most one of them live, which every existing read already tolerates: `findByEmail` filters `deleted_at is null` and is the only lookup authentication uses.

`repository.create` must move from `onConflictDoNothing({ target: users.email })` to the partial form (`targetWhere`), or the insert matches no index, raises the unique violation instead of returning `undefined`, and a duplicate registration answers `500` rather than `CONFLICT`. That is the one place this change is load-bearing and is called out so it is not discovered from a log.

### Users — a deleted account is read-only

`PATCH /:id`, `POST /:id/sessions/revoke` and `POST /:id/password` ([ADR-0027](0027-credential-self-service-and-reset.md)) refuse a soft-deleted subject with `409 USER_DELETED`.

Reads keep working. `GET /:id` still answers through `findAnyById`, because an admin who can list deleted accounts must be able to open one, and answering `404` for a row they were just shown is the worse lie — that reasoning is already in the code and does not change. What changes is that the write path stops sharing the read path's tolerance.

`409` and not `404`: the account exists and the caller may see it; the request conflicts with its state. That is the same distinction `STAFF_LAST_SUPER_ADMIN` draws.

**There is no restore endpoint in v1**, and the reason is the partial index above: once an address can be re-registered, restoring an account has to decide what happens when its address is now live on another row. That is a real conflict-resolution rule, it is not needed by anything today, and inventing it unused is how it gets invented wrong.

### Staff — hard delete

```
DELETE /api/v1/admin/staff/:id    (role admin)   → 204
```

The row is deleted. `staff_roles.staff_id` cascades, so the grants go with it; `staff_roles.granted_by` is `on delete set null`, so grants this person issued to *others* survive with a null granter, which is the audit behaviour the schema already chose deliberately.

Four rules, three of which are guards this repository already owns:

1. **The ADR-0017 rank rule.** `assertMayActOnSuperAdmin` — deleting a super admin is the most complete removal of standing there is, so it is refused to anybody who is not one, exactly as disabling and forced logout already are.
2. **The last-super-admin invariant.** Deleting the only active `super_admin` is refused with `STAFF_LAST_SUPER_ADMIN`, behind `lockRoleInvariant` and the existing `countOtherActiveSuperAdmins` — under READ COMMITTED, two concurrent deletes of two different super admins would otherwise each count the other as the survivor and both commit, leaving a deployment with no super admin and no way back through the API. The advisory lock exists for precisely this and is taken before the count.
3. **Sessions are revoked in the same transaction, before the row goes.** `sessions` has no foreign key, so deleting the principal leaves its sessions behind; an orphan is unusable because the principal lookup after session verification fails, but "unusable in practice" is not the same as "revoked", and the audit trail should say `account_deleted` rather than nothing.
4. **A staff member may not delete themselves.** Plain `403` with a message, no new error code — the same shape `superAdminGrantForbidden` uses. Self-deletion is the one delete whose actor vanishes mid-request, it interacts with the invariant above in a way nothing else does, and an operator who wants out is disabled or deleted by another admin. This is a one-line rule that removes a whole class of question.

### Contracts

- `USER_DELETED` (409) is added to the error-code union with its row in the table.
- `REVOKE_REASONS` gains `accountDeleted: "account_deleted"`.
- No request body: both endpoints take `:id` and nothing else. Deletion needs no payload, and `setPasswordBody`'s actor re-authentication (ADR-0027) is deliberately **not** copied here — deletion of a customer is reversible in the sense that matters (the row survives), and staff deletion is already fenced by three guards plus the role check. If step-up authentication is ever built as a category, these are the next two endpoints to put behind it.

## Consequences

- The read path built in D1 stops being unreachable, and the `findById` / `findAnyById` split, the `deletedAt` filter and the resource field all start describing states the API can actually produce.
- The Postman teardown can delete the accounts each run creates instead of disabling them. ADR-0021's D1.10 amendment settled for disabling them "because it cannot delete them — v1 has no delete endpoint", and noted that a live account with a password committed in this repository is a way in while a disabled one is a row. A deleted one is neither. ADR-0021 is frozen under [ADR-0025](0025-deliverables.md) rule 2, so this is recorded here and executed as a D2 step; the collection changes, the ADR does not.
- Deleted customer rows accumulate, by design, and nothing prunes them. That is what soft delete is, and the retention question — how long a deleted account's personal data is kept — is a policy decision that belongs with the compliance work, not here. It is worth naming now because the answer is currently "forever".
- The partial unique index changes the meaning of a duplicate-email conflict: it now means "a *live* account has this address". Every message that phrases it that way stays true; any that says "this address has ever been used" would not, and none does.
- Hard-deleting staff loses the audit answer to "who used to be an admin here". `staff_roles` rows for that person are gone with the account. That is the cost of the schema decision ADR-0006 and ADR-0017 already made, restated so it is a known cost rather than a surprise; if it becomes unacceptable, the fix is an append-only audit log, not a `deleted_at` column on `staff`.

## Alternatives considered

- **Soft-delete staff too, for symmetry.** Adds a nullable column, a scope to every staff read, and a second "is this row real?" question in the population where `super_admin` lives — for a directory entry the domain has no reason to keep. The asymmetry is the decision ADR-0006 already made; symmetry for its own sake would be the change.
- **Hard-delete users.** Simplest, and it destroys rows that future order history will reference. Rejected by ADR-0006's "soft delete where the domain needs it".
- **Keep the plain unique index and burn deleted addresses.** Zero migration, and the resulting support answer — "that address can never be used again on this system" — is one nobody will accept.
- **Release the address by rewriting it on delete** (`deleted+<id>@…`). No migration and no partial index, and it destroys the record of what the address was, which is the one thing a deleted account is kept for. It also makes the column lie about its own contents.
- **Allow `PATCH` to clear `deleted_at` as the restore path.** Turns a field edit into a lifecycle transition with none of the conflict handling described above, and leaves the active-and-deleted state reachable through the same request.
- **`410 Gone` instead of `409` for writes to a deleted account.** Semantically attractive; `410` says the resource is permanently gone, and this one is still readable at the same URL by the same caller. `409` says what is actually true.
