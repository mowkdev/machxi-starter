# D29 — Backend closing wave: build notes

The per-step build record of [D29](0029-backend-closing-wave.md) — what was built, the amendments, the review findings and their fates, the gate's output, the spike's result, and what is pending the operator — kept apart from the executable plan so a builder opens the plan and not the journal ([ADR-0068](../adr/0068-behaviour-specs-and-plan-notes.md) §2, the plan apart from its notes). `/step` appends here; `/ship` and the close-out read it.

## D29.1 — Accept ADR-0078; the runner applies by hash, with a concurrent lane (2026-09-30)

**Built.** [ADR-0078](../adr/0078-backend-closing-wave.md) was accepted at the head of the step. [ADR-0008](../adr/0008-database-migrations-and-seeding.md) and [ADR-0060](../adr/0060-list-endpoints-at-scale.md) moved to `superseded by`, each with its delta stated in the status line and a dated note. The index rows, the migrations topic row and the ledger's running paragraph say so. `scripts/rules-digest.mjs` gained the line "Migrations applied by hash" (0078), and the digests were regenerated.

`packages/db/src/migrate.ts` replaces Drizzle's `migrate()` with its own loop:

- `readMigrations` reads the journal and hashes each file after normalising it to LF.
- `pendingMigrations` returns every entry that no row of `drizzle.__drizzle_migrations` records, by hash or by journal timestamp. The apply order is journal order.
- A run of consecutive ordinary files shares one transaction.
- A file whose first line is `-- migrate:concurrently` runs statement by statement outside any transaction. It is recorded only after its last statement succeeds.
- The run is under a session advisory lock on one connection.

Supporting changes:

- `.gitattributes` pins `packages/db/migrations/**` to LF.
- `CreateDbOptions` gains `maxLifetime`.
- `/db-schema-change` states the two lanes and how to write a second-lane file.
- `docs/forking.md` gains "The migration journal", on how a fork merges the journal, and a row in the conflicts table.

**Amended in place (0078 §1, labelled `D29.1`).**

- **An entry counts as recorded by its hash or by its journal timestamp.** The dev database holds Drizzle rows whose hashes match no committed file: `0007`, `0008`, `0010` and `0013`. A hash-only rule would have replayed four migrations onto it. A dry run of `pendingMigrations` against its rows showed exactly those four under hash-only, and none under the amended rule.
- **How a file is marked for the second lane.** The mark is the file's first line, not a journal field. Each chunk holds one statement, and an index is dropped before it is rebuilt.
- **The two lock consequences the review found.** They are listed under "Review" below.

**Review.** One `code-reviewer` pass returned three findings. All three were confirmed and fixed:

1. **postgres.js's default `max_lifetime` (30–60 min) could retire the runner's connection mid-run.** The session lock would then not survive into the next statement. Fix: the runner passes `maxLifetime: 0`, and `createDb` forwards the key only when it is stated, so the API keeps the driver default.
2. **A waiter blocked in `pg_advisory_lock` holds a snapshot, and `CREATE INDEX CONCURRENTLY` waits on it.** Two overlapping runs over a marked file therefore deadlock. The new case "two runs over a concurrent-lane file serialise without a deadlock" was **red against the blocking call** (it failed after 11 s). It is green now that the lock is polled with `pg_try_advisory_lock` every 500 ms.
3. **No case isolated the hash half of the rule.** Added "a row whose timestamp is not the journal's still counts by its hash".

**Done-when evidence.**

- The three named cases in `migrate.int.test.ts` are green: "an entry older than the newest applied one is still applied", "a database migrated by drizzle has nothing pending" and "a concurrent-lane file is recorded only when its last statement succeeds". The file has 11 cases, all green.
- `pnpm db:migrate` against the dev database printed `db:migrate ✓ up to date`. It was run before and after the review fixes, and applied nothing both times.
- `pnpm db:migrate -- --test`, after emptying `machxi_d29_test`, printed each of `0000`–`0018` as applied, then `db:migrate ✓ applied 19, up to date`.
- `docker compose -f docker/prod/compose.yaml build migrate` succeeded, rebuilt over the final code. In the image, `/app/migrations` is LF and the bundle carries `pg_try_advisory_lock` and `max_lifetime`.
- The gate is green: `lint` 22/22, `check-types` 17/17, `test` 17/17 (`@repo/db` 105 unit + 118 int; `api` 786 unit + 823 int), `size` 4/4, `format:check` clean.

**Which database the gate ran against.** The first gate run's API integration tier ran against the shared `machxi_test`, not `machxi_d29_test`. The cause is that the tracked `apps/api/.env.test` is loaded with `override: true`, so it wins over the worktree's root `.env`. That run failed 91 cases in 7 files on `40P01` deadlocks, colliding with D31's gate in the same window. The `/steps` coordinator then pointed the worktree's `apps/api/.env.test` at `machxi_d29_test`, as a local-only change marked `skip-worktree` and not committed. After that, the gate re-run twice against `machxi_d29_test` and was green both times. The `@repo/db` tier always ran against `machxi_d29_test`.

**Residual, for the operator to route.** The lane's test-database isolation covers the API tier only through that local, uncommitted edit. The next lane that opens meets the same thing unless the harness gets a sanctioned override.

## D29.2 — The key ring (2026-09-30)

**Built.** [ADR-0018](../adr/0018-authentication-sessions-and-tokens.md) (its fifth partial successor) and [ADR-0072](../adr/0072-federated-identity-google-sign-in.md) moved to `superseded by` [ADR-0078](../adr/0078-backend-closing-wave.md) at the head of the step, each with its delta in the status line and a dated note; 0072's second half, the exchange's lock order, is `D29.3`'s. The index rows, both topic rows and the ledger's running paragraph say so. `scripts/rules-digest.mjs` gained the line "The key ring" (0078), and the digests were regenerated.

- `modules/auth/auth.tokens.ts`: `createTokenService` takes `previousSecret`. Every token carries `kid` = `accessKeyId(secret)`, an HMAC-SHA256 of a fixed label under the secret, truncated to 16 base64url characters. Verification resolves the key from the header through `jwtVerify`'s key function: no `kid` means the current secret only, a known `kid` means its secret, and anything else throws. That throw is answered as `AUTH_TOKEN_INVALID`.
- `core/oidc/transaction.ts`: `deriveOidcTransactionSecret` (HKDF-SHA256, label `oidc-transaction-key-v1`) and `oidcTransactionSecret({ transactionSecret, accessSecret })`. The composition in `modules/auth/wire.ts` hands the codec that key and never the access secret.
- The schema gains `JWT_ACCESS_SECRET_PREVIOUS` and `OIDC_TRANSACTION_SECRET`, both optional with a minimum of 32 characters and blank read as unset. Each refuses a `KNOWN_PUBLIC_SECRETS` value in production. In every environment, the schema also refuses a previous secret equal to the current one and a codec key equal to either access secret. They reach the code as `config.auth.previousAccessSecret` and `config.federated.transactionSecret`.
- Both `.env.example` files carry both variables commented out and empty. The production compose passes both as bare keys. `docs/deploy.md` gains "Rotating the signing secret": the three-move rotation, the leak variant and the codec's key. No `turbo.json` entry, because no task reads either variable (the API's tiers load `.env.test`).
- Specs: `auth-sessions.md` gains "The signing secret rotates without a sign-out" and `federated-identity.md` gains "The transaction cookie is signed under a key of its own".

**Amended in place (0078 §2, labelled `D29.2`).** It now records how the `kid` and the derived key are made (an HMAC rather than a digest, so the public header is no oracle; a versioned HKDF label, whose change is a rotation of the codec's key alone) and the two equality refusals.

**Review.** One `security-reviewer` pass returned no Critical, High or Medium findings, and two Lows:

1. **Nothing makes `JWT_ACCESS_SECRET_PREVIOUS` expire.** An operator who skips step 3 of the rotation keeps the old key verifying. This is operational, and the leak procedure in `docs/deploy.md` says to set no previous key at all. **Logged, not fixed**; a startup line naming the variable's presence is the smallest fix if the operator wants one.
2. **A 96-bit `kid` collision would let the previous key replace the current one in the ring.** Theoretical. **Fixed**: the current key is inserted last, so it always wins.

Risks the reviewer named for a later record: the no-`kid` path is permanent and could be retired one TTL after this release, there is still no redaction path for `*Secret` config keys (harmless while config is never logged), and HS256 stays the model with EdDSA as ADR-0018's named later step.

**Done-when evidence.**

- `auth.tokens.test.ts` cases "a token signed under the previous secret verifies", "a token naming an unknown key is refused" and "a token with no key id verifies under the current secret" are green. So are "signs under the current secret and names it" and "refuses a token that names one key and is signed under the other".
- `transaction.test.ts` case "the codec's key is not the access token's" is green.
- `config.test.ts` case "a committed value is refused in production for every secret" is green for all three variables, and so are four ring and codec-key cases.
- `committed-secrets.test.ts` is green, with a new case per committed env file for the two new variables.
- `auth.int.test.ts` is green inside the API integration tier (823 cases).
- `security-reviewer` read the diff (above).
- `pnpm test --filter=api` is green: 803 unit and 823 integration cases, against `machxi_d29_test`.
- The gate was green on the first run, before the review fix: `lint` 22/22, `check-types` 17/17, `test` 17/17 (`api` 803 unit and 823 integration), `size` 4/4, `format:check` clean.
- **After the review fix, the gate went green on the fourth run.** The fix reorders two `Map.set` calls. Two full re-runs before this one each failed two API integration cases, a different pair each time, all in concurrency tests. The first run's pair was `account-tokens` "makes a second mint for the same pair wait" and `staff-delete` "survives two super admins deleting each other at once". The second run's pair was `impersonation` "refuses two concurrent exchanges of one handoff" and `federated-identity` "refuses the link start, unlink and the set-password link on an impersonated session", both answering `500` after about 10 s. The one cause the log names is `write CONNECT_TIMEOUT localhost:5432` from postgres.js, which is the database connection timing out under load. Under `/step`'s two-failures rule the step stopped, uncommitted, for the operator. The operator's one retry ran with D31 holding its gates and was green: `lint` 22/22, `check-types` 17/17, `test` 17/17 (`api` 803 unit and 823 integration; `@repo/db` 105 unit and 118 integration), `size` 4/4, `format:check` clean. **Residual, for the operator to route:** the API's concurrency cases time out on connecting when both lanes gate against the one Postgres at once.
- `pnpm test:postman` has not run. It needs the running API to carry this step, which happens only once the step is on `main`.

## D29.3 — Lock order, and the retry (2026-09-30) — built, gate not yet green, uncommitted

**Built.**

- `core/db/transaction.ts`: `createTransaction({ open, logger, maxAttempts = 3 })`, wired at `core/container.ts` as the helper every service receives. A transaction aborted with SQLSTATE `40P01` (found anywhere in the `cause` chain, since Drizzle wraps the driver's error) is run again from the start, three runs in all; each retry is a `warn` on the request's logger (the process logger outside a request). Every other failure passes through on the first run.
- `core/tokens`: a per-principal **credential lock** (`lockCredentials`, a transaction-scoped advisory lock keyed `credentials:<type>:<id>`, apart from the mint's key space). `supersedeAll` takes it after the `reset_password` sweep (the reset by mail arrives holding that row, so a second sweep must still queue on it first) and before every other purpose. `lockHolderOf` reads whom a live token names without claiming it (`holderOf`, a plain select filtered as the consume filters) and takes that lock; the consume is still the one statement that spends a token.
- `exchangeFederatedHandoff`: credential lock → account row (`federated.lockAccount`) → consume. The callback's two minting branches (resolve by subject, by address) take the credential lock before `lockAccount`.
- Specs: `auth-sessions.md` gains "A request that loses a deadlock is answered as if it had not" (three scenarios, proved by `container.test.ts`); `federated-identity.md`'s reset requirement gains the exchange's and the sign-in's turn-taking, with two scenarios.
- ADR-0078 §3 amended in place (`D29.3`) with the order, the bound and the residual; ADR-0072's supersession note says the lock order is built; index rows for 0072 and 0078; digest line "Lock order, and the deadlock retry" (0078), digests regenerated.

**Tests.** `container.test.ts`: "a deadlock victim is retried", "a transaction that keeps losing surfaces the error", "passes any other failure through on the first attempt". `tokens.test.ts`: the sweep's lock position and `lockHolderOf`'s two cases. `federated-identity.int.test.ts`: "an exchange racing a reset ends in one outcome and no deadlock", "an exchange racing a reset's first sweep waits holding nothing", "a sign-in racing a reset's first sweep waits holding nothing". Each plays the event's locks in the suite's own transaction and runs its remaining statements under `lock_timeout = 500ms` (below Postgres's one-second deadlock timeout), so an inverted order fails the case rather than being hidden by the retry. **Each was red against the code without the part it tests** (`55P03` on the handoff row, on the users row, on the users row), and green with it.

**Review.** One `security-reviewer` pass: exchange order, retry safety (mail after commit everywhere, the OIDC HTTP call outside the transaction, no nested transactions or accumulating state), the peek and the advisory key found sound.

1. **[Medium, fixed]** The callback locks the account and then mints, superseding an older live handoff a credential event's sweep may already hold — a pre-existing deadlock edge the step's documents claimed closed. Fix: the callback takes the credential lock before `lockAccount`; the third integration case above, red without it.
2. **[Low, fixed]** The spec and the amendment overstated "no deadlock"; both now name the callback and the one residual.

Residual (named in 0078 §3): a password login takes no credential lock, so its session cap against a reset's session sweep is left to the retry.

**Gate — not green, stopped for the operator.**

- `pnpm check` green (17/17) before the review fix; targeted runs after it: `federated-identity.int.test.ts` 54/54, API unit `src/modules/auth` + `src/core` 578/578, `tsc -b` clean.
- Gate run 1 (before the review fix): `@repo/db#test` failed with 80/80 and 105 tests passing but three "Worker exited unexpectedly with exit code 3221225794 (0xC0000142) during starting state" — a Windows process-start failure, not a test.
- Gate run 2 (after the fix): `lint` 22/22, `check-types` 17/17, `@repo/db` 105 unit + 118 int, `api` 809 unit green; the API integration tier's global setup failed on `write CONNECT_TIMEOUT localhost:5432` (`drop schema if exists public cascade`).
- Gate run 3 (the one re-run): everything green but one API integration case, `impersonation.int.test.ts` "refuses an expired handoff" — the mint answered `500` after 10 s (825/826). The file is green alone (26/26); nothing in it touches this step's code.
- Under the lane's rule (a second environmental failure stops the step), the step is uncommitted and not merged to `main`. `size` and `format:check` never ran, because the chain stops at `test`; `lint` (carrying `docs:check`) was green in runs 2 and 3.
