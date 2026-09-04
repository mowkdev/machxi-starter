# Audit log

`audit_events` is an append-only table of who did what: an actor, the account they were acting as when the two differ, a dot-namespaced event and a small `data` object, stamped with the request id, address and user agent. It has no read endpoint; it is read by SQL by whoever has database access.

## Requirement: A row cannot be changed or removed

An `UPDATE` or `DELETE` on `audit_events` raises on the application connection — the grant is revoked — and on the owner connection — a row trigger refuses — so neither the API nor an operator at the console can rewrite history. Retention is a reviewed migration, never a job.
Records: [ADR-0058](../adr/0058-append-only-audit-log.md), [ADR-0061](../adr/0061-database-roles-and-append-only-enforcement.md)
Proved by: `packages/db/src/__tests__/audit-append-only.int.test.ts`

### Scenario: The API role

- **WHEN** an `UPDATE` is attempted as the application role
- **THEN** it fails with `permission denied` (SQLSTATE `42501`)

### Scenario: The owner role

- **WHEN** a `DELETE` is attempted as the owner
- **THEN** the trigger raises naming the table as append-only (SQLSTATE `P0001`)

## Requirement: A lifecycle write shares the operation's transaction

A lifecycle event — an impersonation minted, exchanged or ended — is written on the caller's executor and awaited, so an operation whose audit row cannot be written does not happen, and a rolled-back operation leaves no row.
Records: [ADR-0058](../adr/0058-append-only-audit-log.md)
Proved by: `apps/api/test/audit-events.int.test.ts`, `apps/api/src/core/audit/__tests__/audit.test.ts`

### Scenario: Rolled back

- **WHEN** a lifecycle write happens inside a transaction that then rolls back
- **THEN** no audit row exists afterwards

### Scenario: Committed

- **WHEN** the transaction commits
- **THEN** the row round-trips with its actor, acting-as and `data`

## Requirement: A trail write never fails the request

The per-request trail under an impersonated session, and a refusal, are written behind the response: the request neither waits for the insert nor fails with it, and a failed insert is logged with both identities so the trail degrades to the logs rather than to nothing.
Records: [ADR-0058](../adr/0058-append-only-audit-log.md)
Proved by: `apps/api/src/core/audit/__tests__/audit.test.ts`, `apps/api/test/impersonation-exclusions.int.test.ts`

### Scenario: An impersonated mutation

- **WHEN** an impersonated session performs a successful write
- **THEN** the response is unchanged and a row `impersonation.mutation` follows with the method, path and status

## Requirement: The identities are the human and the account, never inverted

The `actor` is the staff member who chose to act and `acting_as` is the customer whose account served the request; on an ordinary session the actor is the principal and there is no acting-as. A row whose two identities are equal stores one; a lifecycle write with no attributable actor is refused rather than written anonymously.
Records: [ADR-0058](../adr/0058-append-only-audit-log.md), [ADR-0057](../adr/0057-impersonation-sessions.md)
Proved by: `apps/api/src/core/audit/__tests__/audit.test.ts`

### Scenario: Under impersonation

- **WHEN** a row is written from an impersonated request
- **THEN** `actor` is `staff:<operator id>` and `acting_as` is `user:<customer id>` — the query "everything this operator did" finds it
