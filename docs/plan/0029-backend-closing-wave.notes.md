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

## D29.3 — Lock order, and the retry (2026-09-30)

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

**Committed before green, then closed in a cloud session (2026-09-30).** The code above was committed at `4e80716` on the operator's request, with the box unticked, so a cloud session could take the lane. That session rebuilt nothing. It installed from the lockfile, found `main` already merged into the lane, and gated on a Linux container with a local Postgres 16 against `machxi_test` (the lane's only gate on that machine, so no second test database was needed). No code, record or spec changed; the one `security-reviewer` pass above covers this diff, and there was no second round.

- `pnpm check` green: 17/17.
- **The gate was green on its first run:** `lint` 22/22 (`docs:check`: inherited documents clean, behaviour specs clean across 16 files, open lanes disjoint with 2 open), `check-types` 17/17, `test` 17/17 (`api` 809 unit and 826 integration; `@repo/db` 105 unit and 118 integration), `size` 4/4 (every budget `ok`), `format:check` clean.
- Done-when cases, run verbose: `container.test.ts` "a deadlock victim is retried" and "a transaction that keeps losing surfaces the error" green (11/11 in the file); `federated-identity.int.test.ts` "an exchange racing a reset ends in one outcome and no deadlock" green, with both "waits holding nothing" cases (54/54 in the file).
- So the earlier failures were the Windows machine's, as they looked: the worker-start crash, the `CONNECT_TIMEOUT`, and the impersonation mint that timed out when both lanes gated at once. None of them came back here. The residual that D29.2's notes named, both lanes gating against one Postgres, is still the operator's to route.
- **Pending the operator:** the merge of this step to `lane/D29` and to `main`. The cloud session pushed only its own branch, `claude/keen-knuth-jwf8xb`, so the step is not closed until `main` carries it.

## D29.4 — Spike: row-level security, one day (2026-09-30)

**Result: green, and it landed.** Built inside the timebox in a worktree of its own (`.claude/worktrees/spike-d29-rls`, branch `spike/d29-rls`), with its own install and its own database, `machxi_d29_rls_test`, created with `machxi_test`'s grants and schema owner. The worktree's `apps/api/.env.test` pointed at that database as a local-only, `skip-worktree` edit that was not committed. The result was then brought onto the lane's branch as one commit, and the worktree was removed.

**Built.**

- **The policies, migration `0019`.** Both tables in `TENANT_OWNED_TABLES` declare `pgPolicy` entries in `packages/db/src/schema/organizations.ts`, and `drizzle-kit generate` wrote the migration, which is unedited apart from its lock note. Each setting that can admit a row has one permissive policy:
  - `app.organization_id` (`*_tenant`): read and write.
  - `app.user_id`:
    - on memberships (`organization_memberships_principal`): **select only**.
    - on invitations (`organization_invitations_invitee` and `_invitee_consume`): select and update. The address is read from `users`, never placed.
  - `app.invitation_token_hash` (`organization_invitations_bearer` and `_bearer_consume`): select and update.
  - `app.tenant_unscoped` set to `staff` or `system` (`*_unscoped`): read and write.

  There is no `FORCE`, so the owner role is not bound.

- **`packages/db/src/tenancy.ts`:** `TENANT_SETTINGS`, `tenantSetting` (a `nullif(current_setting(…, true), '')` expression) and `setTenantScope(tx, scope)`, which places the settings in one `set_config(…, true)` statement and makes no round trip when there is nothing to place. `createDb` gains `tenantUnscoped`, a session-level widening for tooling. The API never passes it.
- **The API.**
  - `core/db/tenant-scope.ts`: `tenantScopeOf(ctx)` maps a user principal to `userId` plus the organization `requireMembership` placed, a staff principal to `unscoped: "staff"`, and anything else to nothing.
  - `openInRequestScope(db)` is now the `open` that `core/container.ts` hands the transaction helper, so every transaction a service opens carries its request's scope. A deadlock retry places the scope again on each attempt.
  - `withinTransaction(transaction)`: the memberships and invitations repositories run on the caller's transaction or open one of their own, and never run on the bare pool.
  - `findPendingByTokenHash` places the hash it reads by.
  - `memberships.enterOrganization` places the tenant before a membership is written: on the personal organization (registration and the federated callback), on team create, and on both accept paths.
- **Seeders, harness, generator.**
  - `runSeeders` places `system` on each seeder's transaction.
  - The API harness gains `asTooling` for a test's own reads of the two tables (11 call sites across 6 files).
  - The `@repo/db` tier's pool is created with `tenantUnscoped: "system"`.
  - The `api-module` generator's organization-scoped branch now emits the two policies, a repository over `withinTransaction`, and a `wire` that takes the transaction helper. Verified by generating a scoped `widgets` module in the worktree: `tsc -b` was clean and its 10 unit tests were green once the table was exported. The generated files were then discarded. Two things the generator already missed, and still misses, are out of this step: it does not add the new table to `packages/db/src/index.ts`, and the template throws a raw `Error`, which lint warns on.
- **No request-wide transaction.** ADR-0067 §5 drew a request-wide transaction, and building one would break three rules in force:
  - §3's retry reruns a transaction from its start, and a savepoint inside a longer transaction cannot do that honestly.
  - Mail is sent after commit, which a transaction that outlives the service's cannot promise.
  - The response would have to wait for a commit that the handler does not own.

  What the spike needed was the request's scope on every transaction, and that is what was built.

**Records.**

- [ADR-0078](../adr/0078-backend-closing-wave.md) §4 was amended in place (`D29.4`) with the mechanism, what it cost and the residual. The header's supersedes list and the title now name 0067.
- [ADR-0067](../adr/0067-organizations.md) moved to `superseded by` 0078, with its delta stated in the status line and a dated note.
- The same move is recorded in the index rows for 0067 and 0078, the "Organizations and tenancy" topic row, the multi-tenancy entry and the ledger's running paragraph.
- The digest gained the line "Row-level security" (0078, 0067), and the digests were regenerated.
- `docs/specs/organizations.md` gained "The database scopes a tenant-owned table by itself, and admits nothing by omission", with four scenarios. The wire is unchanged.

**Tests.**

- `enumerations.test.ts` "every tenant-owned table carries a policy": green; **red with `organization_memberships`' policies removed** (it names the table); green again once they were restored. It also has a negative case in-file.
- `schema.int.test.ts` "migration 0019": row-level security is on for every listed table; the application role with no setting sees nothing and an insert is refused `42501`; a transaction scoped to one organization reads its rows alone; the setting does not outlive the transaction.
- `organizations.int.test.ts`:
  - "**a query that forgets its organization returns nothing**" is green.
  - "shows a member's request its organization and the caller's own rows, and no other tenant's".
  - "refuses a write into an organization the transaction is not scoped to" (`42501`).
  - "lets the staff segment read every tenant, by the setting that names it".
- `tenant-scope.test.ts`: 5 cases. `seed-runner.test.ts`: the scope is placed on each seeder's transaction.

**Integration tier's duration.**

| Tier       | Before (tree at `c68e34d`) | After                                                   |
| ---------- | -------------------------- | ------------------------------------------------------- |
| `api`      | 75.88 s, 826 cases         | 74.40 s, 73.28 s and 75.97 s over three runs, 830 cases |
| `@repo/db` | 9.45 s, 118 cases          | 9.39–9.76 s, 121 cases                                  |

Both were measured against `machxi_d29_rls_test` on this container. No measurable cost: each tenant-owned read outside a caller's transaction adds a `BEGIN`, a `set_config` and a `COMMIT`, and they do not show at this scale.

**Review.** One bounded security pass over the diff, against `.claude/agents/security-reviewer.md`'s checklist and the RLS surface. **It was run in-session by the builder, not by an independent `security-reviewer` subagent, because this cloud session had no tool to spawn one.** It found no Critical, High or Medium findings. What was verified:

- Every setting is placed through bind parameters, and the policy SQL is built only from constant setting names.
- The composition root has exactly one `.transaction(` in `src`, so no transaction escapes the scope.
- `ctx.organization` is written only by `requireMembership`.
- An impersonated session scopes as its user.
- A retry re-places the scope.
- The bearer setting only admits the row whose hash the caller holds.
- `enterOrganization` is only reached after the invitation is spent, its address matched, or its organization created in the same transaction.

Two findings, both **logged, not fixed**:

1. **[Low]** `createDb({ tenantUnscoped })` can be reached from production code. Nothing but convention keeps the API's pool from passing it. The smallest fix is a lint selector in `packages/config-eslint/api.js` refusing the key under `apps/api/src`.
2. **[Low]** The principal policy lets a user's request read that user's own memberships in every organization. A forgotten scope inside a user's request can therefore still return _their own_ rows elsewhere, but never another account's. This is named as a residual in 0078 §4.

**Gate: green on the final run in the worktree.**

- `lint` 22/22. `docs:check` reported: inherited documents clean, behaviour specs clean across 16 files, open lanes disjoint with 2 open.
- `check-types` 17/17.
- `test` 17/17:
  - `api`: 814 unit and 830 integration.
  - `@repo/db`: 107 unit and 121 integration.
- `size` 4/4.
- `format:check` clean.

Earlier runs failed twice, each fixed before the green run. The first failed the lock-note hygiene case, because `0019` had no ADR-0060 §5 note; the note was added. The second failed only `format:check` on the generated snapshot, which prettier fixed.

**Pending the operator.**

- The independent `security-reviewer` pass: **done**, below.
- The merge of this step to `main`: **done** on the operator's instruction, below. `lane/D29` was not moved.
- **`pnpm db:migrate` against the dev database** before the running API takes this code. Code that places settings runs fine on a database without `0019`, but the tests assert the policies. After that, one walk of the organizations screens and an invitation accept on the dev stack.
- `pnpm test:postman` has not run: no stack runs in this container. The wire is unchanged.

**Gate on the committed tree (2026-09-30).** After the worktree's commit was fast-forwarded onto `claude/keen-knuth-jwf8xb`, the gate was run again in the main checkout, against this container's `machxi_test`, and was green: `lint` 22/22, `check-types` 17/17, `test` 17/17 (`api` 814 unit and 830 integration in 76.92 s; `@repo/db` 107 unit and 121 integration), `size` 4/4, `format:check` clean. The spike's worktree, its branch and `machxi_d29_rls_test` were then removed.

**Independent `security-reviewer` pass (2026-09-30).** The orchestrating session ran the `security-reviewer` agent over `710178f`. It found **no Critical, High or Medium findings**, and four Lows, **logged and not fixed**. None of them lets a request reach another tenant's rows through the application as it stands.

1. **The consume policies do not pin columns.** `invitee_consume` and `bearer_consume` are `FOR UPDATE` with `USING` only, so the check reuses that expression. A transaction that can see an invitation could rewrite `organization_id` or `role` while keeping `email` or `token_hash` unchanged. No path does this today. The smallest fix is a column-level `GRANT UPDATE (accepted_at, declined_at, revoked_at, updated_at)` to the application role, re-issued if the table is recreated, as ADR-0061 §2 does for `audit_events`.
2. **A setting already on the session carries into every request transaction.** `setTenantScope` skips absent keys, so a session-level value (the `tenantUnscoped` startup parameter, or a `set_config(…, false)`) reaches every request transaction. This is the root of the builder's Low 1. The smallest fix: `openInRequestScope` sets all four settings on every transaction, writing `''` for an absent one.
3. **Nothing at runtime checks that the policies bind the API's role.** No `FORCE`, and no boot check that the API's role is not superuser, not BYPASSRLS and owns no tenant table. That holds in this repository, but a fork on an owner role or a managed platform's default user would silently lose every policy. The smallest fix: a boot assertion outside development and test, plus a line in `docs/deploy.md`. The migration's reason for not forcing also names TRUNCATE, which row-level security never governs.
4. **The builder's Low 2, slightly wider.** Inside an organization-scoped request, `app.user_id` stays set. A forgetful query can therefore also read, and stamp, invitations addressed to the caller in other organizations, but only ever the caller's own rows. A possible fix is to omit the user once the organization is placed, to be confirmed by the integration tier.

**Two operational notes.**

- `0019` takes its ACCESS EXCLUSIVE locks without a `lock_timeout`.
- An old build against a migrated database fails closed: 404s on organization routes, and `42501` surfacing as a 500 on registration and team creation. Deploying code first and migrating second is the safe order.

**Residuals for a later record.**

- A session-settable `unscoped` value does not stop SQL injection. The alternatives are a separate role or pool for staff, or a SECURITY DEFINER setter.
- Staff see every tenant at the database level.
- The scope is read from AsyncLocalStorage rather than from `ctx`.
- The repository-level tests run under `system`.

**Merged to `main` (2026-09-30)** on the operator's instruction to merge each step as it lands. `main` was fast-forwarded to this commit.

## D29.5 — The reference images, the compose, and the compiler's memory (2026-09-30)

**Head: [ADR-0059](../adr/0059-ci-containers-and-deployment.md) and [ADR-0073](../adr/0073-review-hardening.md) moved to `superseded by` [ADR-0078](../adr/0078-backend-closing-wave.md)**. 0059 moved for §4's images and install layer and §6's limits and log driver; 0073 moved for §6's residual. Each got a status delta, a header blockquote, and its index row, and the two topic rows name 0078. ADR-0078 §5 and §6 are **amended in place** with what was built and measured. `pnpm rules:digest` wrote 3 of 3: "The first link runs every check" states the decision, and a new "The reference images" line was added. The second run wrote 0 of 3.

**Built.**

- **The SPA images** now run `nginxinc/nginx-unprivileged:1.29-alpine` as uid 101, and the runtime stage states `USER 101`. `nginx.conf` listens on 8080, the image exposes 8080, and the compose file maps loopback to 8080. The `HEALTHCHECK` runs BusyBox `wget --spider` against `/healthz`, an exact-match location. It is unlogged, answers `200 ok`, and inherits the server's headers. Renovate's base-image rule now names the new image.
- **The fetch layer**, in all three Dockerfiles: `COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./`, then `RUN pnpm fetch`, both before `COPY . .`, and then `pnpm install --frozen-lockfile --offline`. In the SPA images the fetch sits above the `ARG`/`ENV` block. `pnpm fetch` takes no `--frozen-lockfile`, since it reads the lockfile alone.
- **The compose file** has one `x-logging` anchor (`json-file`, `max-size: 10m`, `max-file: 3`) on all five services. Each service also has `deploy.resources.limits`: api 1 CPU / 1G, migrate 1 / 512M, prune 0.5 / 256M, each SPA 0.5 / 128M. `docs/deploy.md` states the limits, the non-root images and the port move, including the Coolify domain port (4000, 8080, 8080).
- **`check-types`**: the root task is `cache: false` with no outputs. Each app's `turbo.json` adds `cache: true` beside its existing `outputs: []`. The three app `tsconfig.json` comments are in the past tense.
- **Hygiene cases** in `scripts/docs-hygiene.test.mjs`:
  - "the SPA images run unprivileged with a health check" checks the unprivileged base, a non-root last `USER`, and one port agreed by `listen`, `EXPOSE`, the health-check URL and the compose target, with the health path a `location =`.
  - "every image fetches from the lockfile before the source is copied".
  - "every service in the reference deployment states its limits and a bounded log".
  - "a package's restored buildinfo cannot mask its own error": `D20.12`'s experiment, run on a scratch copy of `@repo/config-vitest`, the composite package with no references, for every effective `check-types` shape the packages resolve to.
  - "no tsconfig writes its buildinfo into a cached output" now skips `cache: false` entries and asserts that a `check-types` task was read, in place of "declares cached outputs".
  - All four new cases were **red on the tree before the change**: the three image cases with the old Dockerfiles, `nginx.conf` and compose stashed; the masking case with the old `turbo.json` files, where it names all fourteen packages and "restoring … `dist-types/tsconfig.tsbuildinfo` exits 0 over a type error". All four are green after.

**The masked error, reproduced first.** On the committed tree, `packages/logger`: I saved `dist-types/`, appended a type error, restored the copy, and ran `tsc -b`: exit `0`. With the marker removed: `TS2322`, exit `2`.

**The decision, by measurement** (ADR-0078 §6 amendment carries the numbers). `pnpm check-types`, 17 tasks, 4 cores:

| run                                                            | before              | after             |
| -------------------------------------------------------------- | ------------------- | ----------------- |
| `--force` cold (no `dist-types/`, no app buildinfo)            | 10.8 s, 10.4 s      | 11.9 s, 10.8 s    |
| `--force` warm                                                 | 1.65 s, 1.61 s      | 1.58 s, 1.71 s    |
| no `--force`, unchanged tree                                   | 0.22 s (FULL TURBO) | 1.43 s (3 cached) |
| CI shape: cache kept, fresh tree, one file added to `apps/api` | 1.9 s (16 cached)   | 7.1 s (2 cached)  |

The emit-without-buildinfo candidate (`outputs: ["dist-types/**", "!dist-types/**/*.tsbuildinfo"]`) took 2.8 s in the CI shape. Afterwards, `config-vitest`, `contracts`, `crypto`, `db` and `logger` each held a buildinfo that `apps/api`'s task had written, which is ADR-0062 §3's cross-package write. `tsc -b --verbose` shows the cause: "out of date because output file '…/dist-types/tsconfig.tsbuildinfo' does not exist". That candidate is refused.

**Docker, in this container.** The daemon was started here (`dockerd`, containerd snapshotter). The sandbox needed three accommodations, and **none of them is in the repository**:

1. Docker Hub answered `429` to anonymous pulls, so both base images were pulled through `mirror.gcr.io` and retagged locally.
2. The egress proxy re-terminates TLS, so `node:24-bookworm-slim` was retagged locally as the upstream image plus the proxy CA (`NODE_EXTRA_CA_CERTS`), for `pnpm fetch` inside the build.
3. The sandbox kernel has **no IPv6** (`/proc/net/if_inet6` absent, `socket(AF_INET6)` gives `EAFNOSUPPORT`). The committed `listen [::]:8080;` therefore fails `nginx -t` here, as the old `[::]:80` would have. The SPA images were built from a scratch copy of the tree with only that line removed.

Results:

- `docker compose -f docker/prod/compose.yaml config` rendered, with logging and limits on all five services.
- `build migrate` (the API image) **succeeded as committed**. In the image, argon2 loads, there is one `pino`, and it runs as `uid=1000(node)`.
- `build admin customer` succeeded from the scratch copy. Both containers reported `healthy` (5/5 probes exit 0), and nginx runs as `nginx` (uid 101) for master and workers. The web root is root-owned and not writable by the runtime user.
- A rebuild after a source edit showed the `COPY package.json …` and `RUN pnpm fetch` layers `CACHED`. The offline install took 0.7 s, against 4.8 s for the fetch.
- `apps/admin/e2e/smoke.spec.ts` with `E2E_BASE_URL=http://127.0.0.1:3101` against the built admin image: **1 passed**.

**Gate.** Green: `lint` 22/22 (FULL TURBO after a `pnpm check` run), `check-types` 17/17 (3 cached, the apps), `test` 17/17 (`api` 814 unit + 830 integration, `@repo/db` 107 + 121, admin 331, customer 282), `size` 4/4, `format:check` clean. The first `pnpm check` went red on **one pre-existing flaky case**, `apps/admin` `settings-provider.test.tsx` "adopts the account's theme when the query resolves". `findByTestId` resolves on the element's first render, and `toHaveTextContent("dark")` is not retried, so under load it reads `system`. The file passed three times in isolation and in the gate's `test` link. It has been unchanged since D22.2, and nothing in this step touches it; it is logged here, not fixed.

**Review — one bounded pass, security-reviewer's checklist over the diff.** This session has no subagent tool, so I ran the pass inline, over the deployment surfaces: images, compose, nginx and the turbo config. There were no Critical, High or Medium findings.

- **Fixed.** Two inaccurate compose comments: "nginx serving files it has in memory" (nginx does not cache files in memory by default), and a log-cap claim about "the last day of an idle API", an estimate nobody measured. Both were rewritten. The masking case's `symlink` type is now `"junction"`, so the case runs on Windows without privilege.
- **Low, logged.** After the build-time substitution, `/etc/nginx/conf.d/default.conf` is owned by uid 101, and the base image leaves `conf.d` group-writable for that user anyway. A process running as 101 could rewrite it and signal the master. Code execution as 101 could equally bind its own server on 8080, so root ownership would buy nothing here.
- **Low, logged, pre-existing.** `listen [::]:8080` stops the image starting on a kernel without IPv6. That is the old behaviour on the new port. The stock image's entrypoint handles this for its own default config only.
- **Residual.** The base images are tag-pinned under the named Renovate rule, not digest-pinned (ADR-0073 §7 as it stands).

**Pending the operator.**

- **A platform whose proxy targets port 80 on the SPA containers must target 8080** from this release. Coolify reads `EXPOSE`, but a domain written with an explicit `:80` suffix breaks. `docs/deploy.md` says so.
- `docker compose -f docker/prod/compose.yaml build` **as committed**, on a machine with IPv6: here the SPA images were built only without the `[::]` listen.
- `pnpm test:postman` and `test:e2e` were not run: no dev stack runs in this container, and the wire is unchanged.

## D29.6 — Close-out (2026-09-30)

Built in a cloud session on `claude/keen-knuth-jwf8xb` at `cad4d09`, which equals `origin/main`. D29 is the only open lane (`docs:check`: "open lanes: disjoint (1 open)"), and `main` since D29.5 has brought in D31's ship and D32's scoping, both docs only. No code, schema or record changed in this step.

**Built.**

- **The six findings carry their fates in both reviews.**
  - [2026-09-13](../reviews/2026-09-13-repo-review.md): each bullet keeps its routing suffix and gains a closing one. `DB-01` closed at `D29.1`, `SEC-01` at `D29.2`, `SEC-07` at `D29.4` and `CI-05` at `D29.5`, each with what closed it and what it left. `SEC-07` points at these notes for the four logged Lows. `CI-05` says the restart policies stand: `unless-stopped` on the four long-running services, `"no"` on `migrate`.
  - [2026-09-21](../reviews/2026-09-21-repo-review.md): the §2 table's fate column reads "Routed D2x; closed `D29.n`" for `SEC-01`, `SEC-07`, `DB-01` and `CI-05`. `CI-07`'s residual, "packages keep the buildinfo under cached `dist-types/**`", is marked closed at `D29.5`, because it is ADR-0073 §6's residual that the plan's step 5 names. `CI-10` and `CI-11` are closed at `D29.5`. `CI-11` keeps one residual by name: the SPA stages still install the whole workspace, argon2 included.
- **The index's planned entry on secret management** now says it was decided by ADR-0078, and not as the one decision the entry expected. It names what was taken and what was declined:
  - Taken (§2, `D29.2`): the two-secret ring with a `kid`, and the codec's own key, derived when unset.
  - Declined (§7): the argon2 pepper, and the credential epoch.
  - Asymmetric signing stays ADR-0018's named later step.
- **The skills and rule files describe the runner.** `/db-schema-change` already did, since `D29.1`. The following were brought into line with what D29 built:
  - The `db-migrator` agent now cites ADR-0008 as carried by ADR-0078. It states the runner (by hash or journal timestamp, in journal order, under the advisory lock), the second lane and the tenant-owned table's policies.
  - `/local-dev` gains two troubleshooting rows: "`db:migrate` sits waiting" (the polled lock) and "a tenant-owned read returns nothing" (row-level security working; use the helper, or `harness.asTooling` in a test).
  - `/new-api-module`: the organization-scoped answer now includes the row-level policies. Services open transactions through the root's helper, never `db.transaction`.
  - `/api-conventions`: the data line names the runner, the second lane, the helper's retry and scope, and row-level security.
  - `.claude/rules/*.md` needed no change: they load the digest, and the digest carries the runner's line.
- **The digests.** `pnpm rules:digest` wrote 0 of 3, twice. Every D29 line was written at its own step.

**Definition of done.**

1. **The gate, every task cold** — `pnpm lint --force && pnpm check-types --force && pnpm test --force && pnpm size --force && pnpm format:check`, exit `0`:
   - `lint` 22/22: `test:scripts` 73/73; `docs:check` "inherited documents: clean", "behaviour specs: clean (16 files)", "open lanes: disjoint (1 open)".
   - `check-types` 17/17.
   - `test` 17/17: `api` 814 unit and 830 integration (75.15 s); `@repo/db` 107 unit and 121 integration; admin 331; customer 282; contracts 246; grid 209; account 110; ui 103; app-kit 84; form 74; api-client 55; crypto 39; resource 31; logger 19; i18n 19; app-services 13.
   - `size` 4/4, every figure `ok`:
     - admin: js 368.1 / 383.8 kB, css 14.8 / 15.2, entry 163.2 / 170.9;
     - customer: js 312.0 / 324.2 kB, css 13.9 / 14.5, entry 106.6 / 111.3.
   - `format:check`: "All matched files use Prettier code style!"

   The integration tiers ran against this container's `machxi_test` (Postgres 16, local, no Docker).

2. **`pnpm test:unit` twice**: 17/17 (16 cached), then 17/17 cached, `FULL TURBO`.
3. **The dev database.** The first `pnpm db:migrate` applied `0019_tenant_row_level_security` to this container's `machxi` and printed `db:migrate ✓ applied 1, up to date`. The second printed `db:migrate ✓ up to date`.

   `pnpm db:seed -- --dev` was run three times:
   - The first run created the super admin, which this container's dev database did not hold.
   - The second and third runs gave **identical output**, the super admin "already present — left unchanged".

   **The operator's own dev database still needs this migrate before the running API takes D29.4's code** (D29.4's pending item, unchanged).

4. **`pnpm test:e2e` in both apps against the local compose: pending the operator.** It was not run. No dev stack runs in this container, and `CLAUDE.md` forbids starting one. The only browser evidence in the lane is D29.5's `apps/admin/e2e/smoke.spec.ts` against the built admin image (1 passed).
5. **`pnpm test:postman`: pending the operator**, for the same reason. It has not run anywhere in D29. The wire changed in no step, but `D29.2`'s done-when named it, so it is owed from that step too.
6. **`docker compose -f docker/prod/compose.yaml`:**
   - `config` rendered, exit `0`, with `logging` on all five services and a CPU and memory limit on each: api 1 / 1 GiB, migrate 1 / 512 MiB, prune 0.5 / 256 MiB, admin and customer 0.5 / 128 MiB.
   - `build` with the SPA origins set (`VITE_ADMIN_API_URL`, `VITE_CUSTOMER_API_URL`, `VITE_CUSTOMER_APP_URL`; the Dockerfiles refuse a blank origin by design): the **API image (api, migrate, prune) built as committed**.
   - Both SPA images **failed as committed on this kernel**: `nginx -t` gave `socket() [::]:8080 failed (97: Address family not supported by protocol)`. This is the no-IPv6 sandbox that D29.5 recorded.
   - Built from a scratch copy of `HEAD` with only the `listen [::]:8080;` line removed from both `nginx.conf`, `build admin customer` succeeded.
   - **`build` as committed, on a machine with IPv6, is pending the operator**, as it was at D29.5.
7. **`pnpm audit --prod`**: "No known vulnerabilities found", exit `0`.
8. **`pnpm rules:digest`** wrote 0 of 3 on both runs. **`pnpm docs:check`** is clean.

**Sandbox accommodations, none in the repository.**

- `dockerd` was started in the background for item 6 and stopped afterwards.
- The base images were D29.5's, still in the daemon's store: pulled through `mirror.gcr.io` after Docker Hub's `429`, with `node:24-bookworm-slim` retagged locally with the proxy CA so `pnpm fetch` reaches the registry.
- The SPA images were built from the scratch copy described in item 6.

**Review — one bounded pass, `adr-reviewer`'s checklist over the diff.** This session has no tool to spawn a subagent, so the builder ran the pass inline, as D29.4 and D29.5 did. It checked each fate and skill claim against the code and the records. Three findings, all fixed:

1. `CI-05`'s fate said the restart policy "stands as `unless-stopped`", but `migrate` is `restart: "no"`. It now names both policies and the four long-running services.
2. `/new-api-module`'s new sentence, "a transaction opened around it has neither", was ambiguous. It now reads "a bare `db.transaction` does neither".
3. `/api-conventions` cited "ADR-0078 §3–§4", a range. It now reads "§3 and §4" with its topic gloss, which is the `.claude/**` citation rule.

After the fixes and this note were written, the gate ran again on the final tree, cached as it stands: exit `0`, with `lint` 22/22, `check-types` 17/17, `test` 17/17 (`api` 814 and 830, `@repo/db` 107 and 121), `size` 4/4 and `format:check` clean.

**Review fates the lane leaves for `/ship` and the operator.** Every one is logged, not fixed, and named in its step's notes above:

- `D29.2`: nothing expires `JWT_ACCESS_SECRET_PREVIOUS`, which is operational, and `docs/deploy.md`'s leak procedure sets none.
- `D29.4`, the builder's inline pass: `createDb({ tenantUnscoped })` is reachable from production code, with a lint selector as the smallest fix. The principal policy admits a user's own memberships in every organization.
- `D29.4`, the independent `security-reviewer` pass over `710178f`, four Lows:
  1. The consume policies pin no columns. The fix is a column-level `GRANT UPDATE`.
  2. A session-level setting carries into every request transaction. The fix is for `openInRequestScope` to write all four settings.
  3. No boot check confirms that the API's role is bound by the policies (not superuser, not BYPASSRLS, owns no tenant table).
  4. `app.user_id` stays set inside an organization-scoped request, so a forgetful query reads the caller's own invitations in other organizations.

  Two operational notes: `0019` takes its locks without a `lock_timeout`, and deploying code before migrating is the safe order.

- `D29.5`: `conf.d/default.conf` is writable by uid 101. `listen [::]:8080` stops the SPA image starting on a kernel without IPv6, which was the old behaviour on the old port. The base images are tag-pinned, not digest-pinned.
- Residuals for the operator to route, from `D29.1`–`D29.3`:
  - The API tier's per-lane test database works only through a local, uncommitted `apps/api/.env.test` edit.
  - The concurrency cases time out on connecting when two lanes gate against one Postgres.
  - A password login takes no credential lock, so a login racing a reset's session sweep is left to the retry (ADR-0078 §3).
- One pre-existing flaky case, logged at `D29.5`: `apps/admin` `settings-provider.test.tsx` "adopts the account's theme when the query resolves". It was green in this gate.

**Pending the operator.**

- Items 4 and 5 of the definition of done: `pnpm test:e2e` in both apps and `pnpm test:postman`, on the running stack once `main` carries D29.
- `docker compose -f docker/prod/compose.yaml build` as committed, on a machine with IPv6 (item 6).
- `pnpm db:migrate` against the operator's dev database before the running API takes D29.4's code, then one walk of the organizations screens and an invitation accept.
- **A platform proxying the SPA containers on port 80 must target 8080** from this release (D29.5, `docs/deploy.md`).
- The merge of this step to `main`. This session pushed only `claude/keen-knuth-jwf8xb`, so the step is not closed until `main` carries it. `/ship` then runs the definition of done again on the committed tree.

## D29.7 — Row-level security, hardened (2026-09-30)

Added after `D29.6` on the operator's decision, from the four Lows of the independent `security-reviewer` pass over `D29.4` (§D29.4 above). Built on `claude/keen-knuth-jwf8xb` in the main checkout, against this container's `machxi_test`; no dev stack ran and the wire did not change, so `test:postman` is not part of this step.

**Built — the four changes.**

1. **Every setting on every transaction.** `packages/db/src/tenancy.ts` gains `replaceTenantScope(tx, scope)`: one `select set_config(…, true), …` over all four settings, `''` for each the scope does not name, always one round trip — the empty scope included, since that is the case a session-level value would fill. `openInRequestScope` now calls it instead of `setTenantScope`, which still only adds and stays for the placements inside a transaction (`enterOrganization`, the token lookup), the seeders and `asTooling`.
2. **A boot refusal.** `apps/api/src/core/db/role-check.ts`: `readRoleRowLevelSecurity` asks `pg_roles` for the connection's `rolsuper` and `rolbypassrls`, and lists every table with `relrowsecurity` whose owner it is or could become (`pg_has_role(current_user, relowner, 'MEMBER')`, in any schema); `rowLevelSecurityBypasses` turns that into reasons; `assertRoleBoundByRowLevelSecurity` throws a coded error naming the role and the reasons and nothing else. `main.ts` runs it after the database probe and before the rate-limit store, **when `config.env` is `production`** — development and test are exempt; a driver error while asking becomes a sentence on stderr and the error goes to the log line, as the probe does. **Read by the flag, not by `TENANT_OWNED_TABLES`**: that list lives in `@repo/db/testing`, the test tier's entry, and the `api-module` generator appends to it there by pattern, so moving it to production code would have been a generator change too; every listed table has the flag (`schema.int.test.ts` "migration 0019"). `docs/deploy.md` step 2 names the requirement (ordinary role, no `BYPASSRLS`, owns nothing, never a member of the owner), and step 5 states the upgrade order across `0019` — code first, then the migration — with the window the compose file's own order leaves and how to close it.
3. **The invitation's column grant, migration `0020_invitation_column_grant.sql`.** Generated with `drizzle-kit generate --custom` (no push; no committed migration edited): `REVOKE UPDATE ON organization_invitations FROM machxi_app`, then `GRANT UPDATE (accepted_at, declined_at, revoked_at, updated_at)`, then a `DO` block asserting the post-condition as `0008` does. Its header carries the ADR-0061 §2 re-issue caveat and the ADR-0060 §5 lock note. The only UPDATE the API issues on the table stamps one terminal column and `updated_at`, so nothing in `src` changed. Two fixtures in `organizations.int.test.ts` moved an invitation's `expires_at` through `asTooling`, which runs as the application role; they now go through a new harness helper, `asOwner` (a short-lived owner connection).
4. **The principal left out of an organization-scoped transaction — tried, and kept.** `tenantScopeOf` returns `{ organizationId }` alone once `requireMembership` has placed an organization. The integration tier stayed green (`api` 834/834, `@repo/db` 121/121) on the first run with it, so it is kept, and 0078 §4's residual narrows to the requests outside an organization.

**Records and derived documents.**

- [ADR-0078](../adr/0078-backend-closing-wave.md) §4 amended in place, labelled `D29.7`, with the four changes and the residuals the ledger row now carries.
- Ledger: **D35, "Row-level security, residuals", `planned`** — a staff role in place of a settable scope, staff seeing every tenant, the scope read from request storage, the repository tests under `system`. Inserted as one row; the table did not reflow.
- `docs/specs/organizations.md`: the RLS requirement restated (the organization as the only scope once placed, the stamps as the only updatable columns, the cleared settings, the boot refusal), the member's-request scenario tightened, and three scenarios added; `Proved by` gains `database-role.int.test.ts` and `role-check.test.ts`.
- The "Row-level security" digest line in `scripts/rules-digest.mjs` says the same; `pnpm rules:digest` wrote `api-and-data.md` once and **0 of 3 on the second run**.

**Tests — the done-when, by name.**

- `apps/api/src/core/db/__tests__/tenant-scope.test.ts` "a transaction clears every setting it does not place": green (renders the opener's statement with `PgDialect` and reads the four `set_config` pairs), beside "still clears every setting when there is no request at all". "scopes a user to themselves…" now expects the organization alone.
- `apps/api/test/organizations.int.test.ts` "a session-level scope does not reach a request transaction": green. It opens a pool with the `tenantUnscoped: "system"` startup parameter, shows a bare statement on it sees every tenant, then a user's request on it sees only their own rows and an anonymous one nothing. **Red with the opener reverted to `setTenantScope`** ("expected false to be true"), green again restored. Put in `organizations.int.test.ts` rather than `schema.int.test.ts` because it needs the API's opener and request context.
- **The boot case lives in a new file**, `apps/api/test/database-role.int.test.ts` "the API refuses a role that bypasses row-level security": green, against the test database's owner role (the realistic mistake — neither superuser nor `BYPASSRLS`, it simply owns the policed tables), beside "lets the application role through". No config or boot test file existed that could reach a database, so the nearest fit was a new integration file; the decision half is unit-tested in `apps/api/src/core/db/__tests__/role-check.test.ts` (superuser and `BYPASSRLS` reasons, the refusal's sentence). The query was also run by hand under `SET ROLE` to a throwaway `BYPASSRLS` role (`f|t|{}`) and as the `postgres` superuser (`t|t|{organization_invitations,organization_memberships}`), both of which the check refuses.
- `organizations.int.test.ts` "an invitee cannot rewrite an invitation's organization or role": green — both UPDATEs refused `42501`, the row unchanged, and the invitee's own decline still `204`.
- "shows a member's request its organization alone — not even the caller's own rows elsewhere" replaces D29.4's "…and the caller's own rows…", for the fourth change.

**`pnpm db:migrate` against the dev database (`machxi`):** `applied 0020_invitation_column_grant` / `applied 1, up to date`, then `up to date`.

**Gate: green.** `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` exit `0`: `lint` 22/22 (`docs:check`: inherited documents clean, behaviour specs clean across 16 files, open lanes disjoint with 2 open), `check-types` 17/17, `test` 17/17 (`api` 820 unit and 834 integration in 79.5 s; `@repo/db` 107 unit and 121 integration), `size` 4/4, `format:check` clean. The first `pnpm check` failed on one lint warning — an exported error class in `role-check.ts` (ADR-0009's no-classes rule) — replaced by a coded `Error` and `isRowLevelSecurityRefusal`.

**Review.** The done-when asks for `security-reviewer` to have read the diff. **This session had no tool to spawn a subagent, so the pass was run in-session by the builder against `.claude/agents/security-reviewer.md` — an independent `security-reviewer` pass is still owed.** No Critical, High or Medium. Verified: every setting still goes through bind parameters and the names are constants; the refusal's sentence names the role and no host or credential, and a driver error reaches stderr as a sentence only; `replaceTenantScope` is called only by the opener, so the in-transaction placements (`enterOrganization`, the token lookup) still add rather than clear; `0020`'s post-condition fails the migration rather than committing a partial grant. Two findings, both **fixed** before commit:

1. **[Low] The ownership probe was scoped to `current_schema()`.** A role whose `search_path` names another schema would have been checked against the wrong one. Now any schema.
2. **[Low] `pg_has_role(…, 'USAGE')` missed a non-inheriting member of the owner**, which is one `SET ROLE` away from bypassing the policies. Now `'MEMBER'`.

Logged, not fixed: the builder's own `D29.4` Low 1 — `createDb({ tenantUnscoped })` reachable from `apps/api/src` — is now harmless to a request's transactions (the opener shadows it, proved above), though a bare statement on such a pool would still be widened, so the lint selector is no longer needed for isolation; it stays a convention.

**Pending the operator.**

- The independent `security-reviewer` pass: **done**, below.
- The merge of this step to `main`: **done** on the operator's standing instruction, below.
- `pnpm db:migrate` against the operator's own dev database (this container's `machxi` is migrated), and, for a real deployment, the upgrade order across `0019` that `docs/deploy.md` now states.
- The boot refusal has not been exercised through `main.ts` itself (a production configuration needs the full variable set); the function it calls is proved against Postgres.

**Independent `security-reviewer` pass (2026-09-30).** The orchestrating session ran the `security-reviewer` agent over `5fc9e78`. It found **no Critical, High or Medium findings**, three Lows and one informational point, all **logged, not fixed**, and routed to D35's row for its scoping. It confirmed that the four settings are replaced on every transaction and that `''` never matches a policy, that no request transaction inherits a session value, that the boot check fails closed and cannot be skipped by configuration, that `0020`'s post-condition counts PUBLIC and inherited grants, that `asOwner` cannot reach the production bundle, and that no organization-scoped path needs the principal.

1. **[Fixed in the follow-up below] The boot check reads only the connection role's own attributes.** A role that is a member of a superuser or BYPASSRLS role passes, one `SET ROLE` away. The smallest fix is a fourth reason, `member_of_bypassing`, in `rowLevelSecurityBypasses`.
2. **[Fixed in the follow-up below] The ownership probe counts only tables whose row-level-security flag is on.** On the code-first release across `0019`, an API wrongly connected as the owner boots, and it keeps serving if `0019` is then applied without a restart. The smallest fix is to refuse ownership of any ordinary or partitioned table outside the system schemas, whatever its flag.
3. **The column grant cannot tell the stamps apart.** An invitee's or a bearer's transaction could set `revoked_at` or `accepted_at` without creating a membership. It widens nothing. A possible fix is a `WITH CHECK` on the two consume policies, or accepting the gap in D35.
4. **(Info) [Fixed in the follow-up below]** `main.ts` logs the same fatal message when the check's own query fails. It still fails closed. The fix is to branch the message on `isRowLevelSecurityRefusal(error)`.

**Further residuals it named** (for D35):

- The boot check is a snapshot taken at startup.
- A `schema.int.test.ts` case should pin that the application role holds no table-wide UPDATE on `organization_invitations`, so the ADR-0061 §2 re-issue caveat is tested.
- No generic pattern yet exists for column-level write limits on a future tenant table.

**Merged to `main` (2026-09-30).**

**Follow-up: the two role-check Lows fixed (2026-09-30).** On the operator's instruction, the independent pass's Lows 1 and 2 and its informational point, amended in place in [ADR-0078](../adr/0078-backend-closing-wave.md) §4 under a `D29.7 (follow-up)` label. Low 3 (the column grant cannot tell the stamps apart) stays logged.

- **Membership.** `readRoleRowLevelSecurity` also lists the superuser and `BYPASSRLS` roles the connection's role is a `MEMBER` of (itself excluded, and nothing listed for a superuser, which `pg_has_role` makes a member of everything); `rowLevelSecurityBypasses` gains the fourth reason, "is a member of … (superuser or BYPASSRLS)".
- **Every owned table.** The ownership probe drops `relrowsecurity`: any `relkind in ('r','p')` table outside `pg_catalog`, `information_schema` and the `pg_toast*`/`pg_temp_*` schemas whose owner the role is a `MEMBER` of, schema-qualified. The refusal names three and counts the rest. Checked against `docs/deploy.md` and `00-roles.sql`: `machxi_app` owns nothing — `drizzle.__drizzle_migrations` and every `public` table are `machxi_owner`'s — and "lets the application role through" stays green.
- **`main.ts`** logs a failed query while asking under its own fatal message; only a refusal is logged as one. Both still stop the process.
- **Tests.** Unit: "names membership in a superuser or BYPASSRLS role…", "names three owned tables and counts the rest", "refuses a member of a bypassing role, and an owner of tables with no row-level security" — all three red against the previous `role-check.ts`. Integration (`database-role.int.test.ts`): "refuses a role that is only a member of a BYPASSRLS role" — red with the membership predicate removed; "refuses the owner of a table whose row-level security is not on yet" — red with `relrowsecurity` restored (as is the owner case, now asserting `public.users` and the migrations table). Both build their roles as the test cluster's superuser in a transaction that is rolled back, so no role, schema or table survives a case; the URL is a new harness-only variable, `DATABASE_URL_TEST_SUPERUSER` (the compose/CI `POSTGRES_USER`), committed in `apps/api/.env.test`, declared in `turbo.json` and `.env.example`, read on demand by that file alone.
- `docs/deploy.md`, `docs/specs/organizations.md` and the "Row-level security" digest line say the same.

**Independent `security-reviewer` pass over the follow-up (`444e194`, 2026-09-30).** It found **no Critical, High or Medium findings**. Both Lows are fixed correctly and `main.ts` still fails closed. The SQL was probed live on PostgreSQL 16.13, in rolled-back transactions. `machxi_app` passes on both `machxi` and `machxi_test`. `CREATE ROLE` is transactional, so the new cases leave nothing behind.

The committed `DATABASE_URL_TEST_SUPERUSER` was judged **acceptable**: `machxi:machxi` is already public in `.env.example` and both workflows, the API never reads the variable, the production template does not carry it, and a production `DATABASE_URL` pointing at it would be refused by this very check.

One new Low and two informational points, **logged, not fixed**, routed to D35:

1. **(Low)** The check reads `current_user` and never `session_user`. A login role switched at connect time, by `ALTER ROLE … SET role` or `options=-c role=…`, passes while the privileged login stays one `SET ROLE NONE` away. The smallest fix is a fifth reason when `session_user <> current_user`.
2. **(Info)** `MEMBER` also counts a PG16 grant made `WITH INHERIT FALSE, SET FALSE`. That is a conservative false refusal, and only the doc comment's wording needs a change.
3. **(Info)** The membership clause lists every role, where ownership stops at three. It names roles only and goes to the fatal log, never to a response.

**Residuals for D35:**

- A committed `machxi_app` password is not refused in production.
- A view or SECURITY DEFINER function owned by `machxi_owner` over a tenant table would bypass the policies unless it is `security_invoker`.
- A membership or ownership granted after boot goes unseen until the next restart.

**Merged to `main` (2026-09-30).**

**Accepted by the operator (2026-09-30), reported green on their own machine:**

- `pnpm db:migrate` on the operator's dev database, applying `0019` and `0020`, then a walk of the organizations screens and an invitation accept.
- `pnpm test:e2e` in both apps against the running stack (definition-of-done item 4).
- `pnpm test:postman` (item 5, owed since `D29.2`).
- `docker compose -f docker/prod/compose.yaml build` as committed, on a machine with IPv6 (item 6's remainder).

**Renumbered (2026-09-30).** The residuals row written here as D34 is **D35**: D34 was taken on `main` the same day by "Lanes on one machine and one `main`".

**Fates of the residuals routed to D35 (2026-09-30, at `D35.4`).** Each item this file routed to the D35 row, with what [D35](0035-row-level-security-residuals.md) did with it. The detail is in [D35's notes](0035-row-level-security-residuals.notes.md).

- From `D29.4`'s independent review, "for a later record":
  - **A session-settable `unscoped` value does not stop SQL injection.** Closed at `D35.2`: `app.tenant_unscoped`, both `_unscoped` policies and the `tenantUnscoped` pool option are gone ([ADR-0083](../adr/0083-row-level-security-without-widenings.md) §1). ADR-0083 §7 states that row-level security defends against a forgotten predicate, not injection. A separate staff role or pool and a signed `SECURITY DEFINER` setter were both declined by name.
  - **Staff see every tenant at the database level.** Closed at `D35.1`: a staff request is scoped to the organization its route names, and to nothing else (§2).
  - **The scope is read from AsyncLocalStorage.** Kept by decision, and held by the concurrency test written at `D35.1` (§6).
  - **The repository-level tests run under `system`.** Closed at `D35.2`: they run under a tenant's scope, and cross-tenant fixtures use `asOwner`.
- From `D29.4`'s builder pass: **`createDb({ tenantUnscoped })` is reachable from production code.** Closed at `D35.2`: the option no longer exists.
- From `D29.7`'s independent review:
  - **Low 3, the column grant cannot tell the stamps apart.** Closed at `D35.2` (the consume policies check the row they leave) and `D35.3` (they admit only an unended invitation, and an invitation carries at most one terminal stamp).
  - **The boot check is a snapshot taken at startup.** Accepted and documented: `docs/deploy.md` says a grant made later is caught at the next restart (`D35.3`). A periodic re-check is named in "Not in D35".
  - **A schema case pinning no table-wide UPDATE on `organization_invitations`.** Closed at `D35.2`.
  - **No generic pattern for column-level write limits on a future tenant table.** Not in D35's scope, and still open for a later record.
- From the follow-up's independent review:
  - **Low 1, the check reads `current_user` and not `session_user`.** Closed at `D35.3`, by the fifth reason (§4).
  - **Info 2, `MEMBER` counts a PG16 grant made `WITH INHERIT FALSE, SET FALSE`.** Accepted as a conservative refusal. `role-check.ts`'s doc comment says so from `D35.4`.
  - **Info 3, the membership clause lists every role.** Accepted: it names roles only, and only in the fatal log.
- "Residuals for D35", from the follow-up:
  - **A committed `machxi_app` password is not refused in production.** Closed at `D35.3` (§5). `D35.4` extends the refusal to a password-less `DATABASE_URL` and to `DATABASE_URL_OWNER`.
  - **An owner-owned view or `SECURITY DEFINER` function over a tenant table.** Closed at `D35.3` by schema tests. `D35.4` adds rewrite rules, and compares the policies on roles, `USING` and `WITH CHECK` (§4).
  - **A grant made after boot goes unseen until the next restart.** As for the snapshot above.
