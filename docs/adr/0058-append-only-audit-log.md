# ADR-0058: An append-only audit log

- Status: accepted
- Date: 2026-09-01

> Written 2026-09-01 by `/scope` for D13 ([`docs/plan/0013-impersonation.md`](../plan/0013-impersonation.md)), the sibling of [ADR-0057](0057-impersonation-sessions.md). `proposed` at writing; **accepted 2026-09-01 at the head of `D13.2`**, the step that builds it; amendable in place while D13 is `in progress` (ADR-0025 rule 2). Additive: it supersedes nothing — no parent moved to `superseded by` when it was accepted, and none needed to: no record before it decided anything about an audit mechanism.

## Context

Nothing in the repository is an audit mechanism. What exists is a scatter of near-audit: pino request logs (rotated away by whatever ships them), `sessions.revoked_reason` as free text, and `staff_roles.granted_by` as the schema's one "who did it" column. `staff.service.ts` has said in a comment since D2 that the real fix for attribution questions "is an append-only audit log, not a column". D13's impersonation is the feature that finally cannot proceed without one — "every impersonated request is attributable" is its scope line — and the operator decided at scoping (2026-09-01) that the mechanism is a **table**, not structured logs alone: logs answer "what is happening", an audit table answers "what happened", and only the second survives log retention and is queryable in an incident.

## Decision

### The table — `audit_events` in `packages/db`

```
audit_events
------------
id uuid pk (uuidv7 — time-ordered, the reason jti chose it)
occurred_at timestamptz not null
actor_type enum('staff','user') not null, actor_id uuid not null
acting_as_type enum('staff','user') null, acting_as_id uuid null
event text not null                 -- dot-namespaced: impersonation.minted, …
request_id text null, ip inet null, user_agent text null
data jsonb null                     -- event-specific facts, small by convention
index (actor_type, actor_id, occurred_at), index (event, occurred_at)
```

- **`actor_type` and `acting_as_type` are their own Postgres type, `audit_actor_type`, not `sessions`' `principal_type`. Amended 2026-09-01 (D13.2)** — the sketch above wrote a bare `enum('staff','user')` for both and left the type identity open, which is a schema decision with a migration cost. Both types are built from the one `POPULATIONS` tuple in `@repo/contracts` (ADR-0023, so there is still a single source for the labels), but they are two Postgres types: a recorded fact may one day need an actor label a live session must never have — a scheduled job, an operator at the console — and `ALTER TYPE … ADD VALUE` on a shared type would widen the column `sessions` is discriminated by, which ADR-0010 refuses by design.
- **No foreign keys, deliberately** — an audit row must survive the hard deletion of its actor (staff, ADR-0028) and of its subject, or the log un-writes itself exactly when it is needed.
- **Append-only is a rule of the code, not just a word in the name**: the repository exposes insert and, in v1, nothing else; no service holds an update or delete path. **Amended 2026-09-01 (D13.2).** The sentence first read "insert and read": the built repository ships the insert half only, because §No read surface in v1 makes SQL the reader and a finder written for the tests alone would be production code with no production caller. The read half arrives with the first reader; the update and the delete never do. The rule is enforced rather than asserted — `packages/config-eslint/api.js` restricts `auditEvents` everywhere but `core/audit/audit.repository.ts`, so a service that wanted an update path could not import the table to write one. `db:*` tooling does not prune it — audit outlives sessions, and retention is a deployment decision recorded in §Consequences, not a job this record ships.
- **Event names live with their writers in `apps/api`**, not in `@repo/contracts`: no client reads them in v1, and a contracts enum for server-only vocabulary is the altitude mistake ADR-0050 names. The day an admin screen lists these events is the day the names cross the wire and earn a contracts home.

### The writer

A small `audit` service in the API's core, container-wired (ADR-0009), taking `ctx` first so every row inherits `requestId`, ip and ua. **The identity mapping is by human, not by principal shape**: `actor` is the identity driving the request — the staff id when the principal carries `impersonatedBy` (ADR-0057 §4), the principal itself otherwise — and `acting_as` is the account the request ran as, set only when the two differ. A builder who maps `ctx.principal` straight onto `actor` writes the inverse and an incident query on the staff id finds nothing; this paragraph is the rule that prevents it. The `impersonation.exchanged` event has no principal at all — the exchange is unauthenticated, the token is the credential — so it derives both identities from the consumed handoff row, never from `ctx`. Two write disciplines, chosen per call site:

- **Lifecycle events are transactional with the operation** — an impersonation mint that cannot be audited does not happen. The writer accepts the caller's transaction.
- **Trail events** (the per-mutation rows ADR-0057 §6 asks for) are **dispatched off the request’s path**, best-effort: a failed trail write logs at `error` and does not fail a request that already succeeded. The completion log line still carries both identities, so the trail degrades to the logs rather than to nothing. **Amended 2026-09-01 (`D13.5`)** — the sentence read “written after the response”, and one of the two writers this step built cannot be. The mutation trail genuinely fires on the response’s `finish`; `impersonation.refused` is dispatched from inside the guard, immediately *before* the refusal is thrown, because there is no succeeding operation to hang it on and waiting for `finish` would put the row behind an error handler that could still fail. Neither is awaited and neither can fail its request, which is the property the discipline is actually for — “after the response” described one implementation of it and read as a rule.

### v1 write points

D13's, and only D13's: `impersonation.minted`, `impersonation.exchanged`, `impersonation.ended`, `impersonation.refused` (an excluded operation attempted — a trail-discipline write behind the refusal response, there being no succeeding operation to join transactionally), and the mutation trail under an impersonated session. The named future write points — role grants, administrative password resets, deletions, the `staff.service.ts` comment's cases — join when a deliverable takes them; this record decides the mechanism, not the coverage.

### No read surface in v1

No endpoint, no grid, no export. The table is read by SQL, by an operator with database access, which is who reads an audit log during an incident. An `/admin/audit` resource screen is a real future deliverable (a grid, a retention story, its own guards) and is deliberately not smuggled in here.

## Consequences

- Impersonation gets a durable, queryable trail that survives log rotation and actor deletion; every later "who did what" feature has a mechanism instead of a column.
- One insert per audited operation — impersonation-rare, negligible; the trail discipline keeps the hot path unharmed.
- **Retention is unbounded until a deployment decides otherwise**; the table grows forever by design and pruning it is an operational choice this record leaves explicitly open.
- The integration tier gains the table's tests; migration `0006` (or next) creates it from nothing on every run.

## Alternatives considered

- **Structured logs alone** — the recommendation at scoping, overruled by the operator for durability and queryability; the logs remain, the table is beside them, and nothing is logged less because of it.
- **Event names in `@repo/contracts`.** Premature: no client reads them, and the enum would be the machine-checkable minutiae ADR-0050 keeps out of records and contracts alike.
- **An outbox/queue for trail writes.** Correct at a scale this blueprint does not have; a best-effort post-response insert loses strictly less than the logs already lose. Reserved, not adopted.
- **Reusing `sessions` columns as the audit.** The row is pruned (`db:sessions:prune`), mutable, and shaped for transport, not history — the objection the `staff.service.ts` comment already recorded.
