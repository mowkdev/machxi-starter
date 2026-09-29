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
