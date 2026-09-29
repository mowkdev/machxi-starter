# ADR-0078: Backend closing wave — migrations applied by hash, a key ring, deadlocks retried, the reference images hardened (supersedes ADR-0008, 0018, 0059, 0060, 0072 and 0073 in part — deltas)

- Status: proposed
- Date: 2026-09-29
- Supersedes (each at the step that makes its delta true): [ADR-0008](0008-database-migrations-and-seeding.md) as carried by [ADR-0059](0059-ci-containers-and-deployment.md) and [ADR-0061](0061-database-roles-and-append-only-enforcement.md) (delta: what decides that a migration is applied, and who runs the statements — the committed SQL, the journal, the owner role and the advisory lock stand); [ADR-0060](0060-list-endpoints-at-scale.md) (delta: §5's second rule — an index on a large table may be built concurrently through a second lane); [ADR-0018](0018-authentication-sessions-and-tokens.md) as carried (delta: the access token is signed under a ring of two secrets and names its key; HS256, the claims, the TTL and the flow stand); [ADR-0072](0072-federated-identity-google-sign-in.md) (delta: §2's transaction codec has a key of its own, and the exchange's lock order); [ADR-0059](0059-ci-containers-and-deployment.md) as carried by [ADR-0073](0073-review-hardening.md) (delta: §4's SPA images and install layer, §6's limits and log driver); [ADR-0073](0073-review-hardening.md) as carried by [ADR-0074](0074-review-follow-ups.md) and [ADR-0076](0076-the-native-compiler.md) (delta: §6's residual, decided at §6 below). Every parent stands for everything not named here.

> Written 2026-09-29 by `/scope` for D29 ([`docs/plan/0029-backend-closing-wave.md`](../plan/0029-backend-closing-wave.md)), from the ledger rows D23, D24, D25 and D27 and the findings they carry — writing is not opening, opening is not accepting. `proposed`; accepted at the head of `D29.1`. Four decisions are the operator's, taken at scoping: §1's runner, §4's spike, what §5 takes of the operations row, and what §7 declines.

## Context

Four rows were left for the backend, and the starter is wanted for a project. Scoping read each against one question: what does it cost to build after a fork exists?

The answer turned on a fact nobody had written down. Drizzle's `migrate()` reads the newest row of its table and applies a journal entry only when the entry's timestamp is later; the hash it stores is never compared. A fork that has applied a migration of its own and then merges an older one from the starter skips it, silently, and the schema and the code disagree from that release on. Every migration the starter ships after a fork exists would meet this, so the runner is decided first and the rest of the wave lands on it.

The other findings are as the reviews left them: one signing secret with no rotation path, shared with the OIDC codec (`SEC-01`); index builds that cannot be concurrent (`DB-01`); tenant isolation enforced by code alone (`SEC-07`); SPA images running as root with no health check, an install layer every source edit invalidates, and a compose file with no limits (`CI-05`, `CI-10`, `CI-11`); and a composite package's restored buildinfo masking its own type error (ADR-0073 §6).

## Decision

### 1. A migration is applied when its hash is recorded

`@repo/db`'s runner replaces `migrate()` with its own loop over the journal: an entry whose hash is absent from the applied-state table is applied, in journal order, and recorded. The table, its columns and the hashes already in it are Drizzle's and are read as they stand, so a deployed database needs no change. The advisory lock, the owner role and the single transaction for the ordinary lane stand.

**A second lane runs outside the transaction.** A migration file marked for it has each statement executed on its own and is recorded when the last one succeeds. Its statements are written to be repeatable, because a failure part-way leaves the file unrecorded and the next run starts it again. It exists for `CREATE INDEX CONCURRENTLY` and for `VALIDATE CONSTRAINT`.

A hash is taken over the file's bytes as committed; the migrations directory is pinned to one line ending so that a checkout cannot change it. [`docs/forking.md`](../forking.md) says how a fork merges the journal.

### 2. A key ring for the access token, and a key of its own for the OIDC codec

`JWT_ACCESS_SECRET` is the current secret and `JWT_ACCESS_SECRET_PREVIOUS` is optional. A token is signed with the current secret and carries a `kid` derived from it; verification picks the secret the `kid` names and refuses any other. A token with no `kid` is verified against the current secret, so a deployment takes this release without a sign-out. Rotation is: move current to previous, set a new current, remove previous after one access-token lifetime.

The OIDC transaction codec stops sharing the key. `OIDC_TRANSACTION_SECRET` is optional; unset, the codec's key is derived from the access secret under a label of its own, so the separation is structural in a default clone and the two rotate independently where a deployment states both. A committed value is refused in production for every secret here, as it is today for one.

### 3. Lock order, and a deadlock retried once

The federated exchange takes its locks in an order that cannot deadlock against a credential event's sweeps, and a concurrent integration case proves it. The transaction helper at the composition root retries a transaction the database aborted as a deadlock victim (`40P01`), a bounded number of times; nothing inside a transaction has an effect outside the database, which is what makes the retry safe and is already the rule for mail.

### 4. Row-level security is a timeboxed spike

[ADR-0067](0067-organizations.md) §5's shape is unchanged. What is unproven is the mechanism under it: a transaction scoped to the request, the setting placed by the membership guard, policies that admit the principal-scoped reads and the staff segment by an explicit setting and nothing by omission, and the harness running as the application role. A one-day spike proves or refutes it. Green lands in D29 and this section is amended in place with what was built; red becomes a planned row with the blocker named.

### 5. The reference images and compose

The SPA images run an unprivileged nginx with a `HEALTHCHECK`. All three Dockerfiles fetch dependencies from the lockfile alone before the source is copied. The production compose states resource limits and a bounded log driver per service.

### 6. What `check-types` caches for a referenced project

Decided by measurement at the step that builds it, between the emit cached without its buildinfo and the task uncached where a package is its own consumer. The step amends this section with the choice and its numbers; the hygiene case that reproduces the masked error is what proves it.

### 7. What this record declines

- **An argon2 pepper.** Adding one later costs what adding one now costs, a rehash on next login, and it would put a secret in the database tooling today.
- **A credential epoch.** §3's retry and lock order bound the race it would close; it stays a named residual.
- **The scheduler seam and the mail outbox.** They stay on the ledger's operations row, planned. The `prune` service already runs in the reference deployment, and §1 is what lets their migration merge into a fork later.
- **Audit retention** stands as [ADR-0058](0058-append-only-audit-log.md) and ADR-0061 decided it: a reviewed migration, never a job.

## Consequences

- A fork merges the starter's migrations and they are applied. The journal is still one file both sides edit; the conflict is a git conflict, resolved by hand.
- The runner is this repository's code. A Drizzle release that changes the journal or the table is read before it is taken.
- A leaked signing secret can be retired without signing everyone out.
- A request that loses a deadlock is answered as if it had not; one that loses repeatedly is still a `500`.
- Three new optional variables, each a three-place change (ADR-0004 as carried), none required in a default clone.

## Alternatives considered

- **Refusing a skipped migration and fixing timestamps by hand.** It makes the skip loud and leaves every merge a manual edit.
- **`JWT_ACCESS_SECRETS` as a list**, the row's wording. A rename breaks every deployment's environment for the same behaviour.
- **EdDSA.** A key pair buys verification without the signing key, which nothing here needs; it remains ADR-0018's named later step.
- **Building row-level security outright.** The mechanism is the unknown, and a stalled step would hold the wave.
