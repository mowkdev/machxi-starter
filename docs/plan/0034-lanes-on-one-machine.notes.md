# D34 — Lanes on one machine and one `main`: build notes

The per-step build record of [D34](0034-lanes-on-one-machine.md) — what was built, the amendments, the review findings and their fates, the gate's output, and what is pending the operator — kept apart from the executable plan so a builder opens the plan and not the journal ([ADR-0068](../adr/0068-behaviour-specs-and-plan-notes.md) §2, the plan apart from its notes). `/step` appends here; `/ship` and the close-out read it.

## D34.1 — Accept ADR-0082; a test database per lane (2026-09-30)

Built in a cloud session on the lane branch `claude/nifty-planck-bnxu4s` (PostgreSQL 16 on localhost:5432, no Docker, no dev stack, no root `.env`), committed and pushed there; not merged to `main` (plan §Constraints).

**Accepted at the head.** [ADR-0082](../adr/0082-lanes-on-one-machine-and-one-main.md) `accepted`. [ADR-0021](../adr/0021-testing-strategy.md), [ADR-0007](../adr/0007-local-development-docker.md) and [ADR-0004](../adr/0004-configuration-and-environment.md) moved to `superseded by` 0082 (delta), each with a note stating its §3 delta. The index rows for all four and the topic table's configuration, local development and testing rows name 0082; the ledger's running paragraph says 0082 is accepted and which parents moved. 0082's own header and index row now name [ADR-0050](../adr/0050-adr-lifecycle-and-verification.md) with 0026 at `D34.2` — the record's supersedes line and the plan's step 2 both name it, and the index row had left it out.

**Built.**

- `packages/db/src/tooling/test-database.ts`: the `_test` suffix guard (`TEST_DATABASE_SUFFIX`, `assertTestDatabase`, moved from `testing.ts`, which re-exports both) and `laneDatabaseUrl(url, lane)`. With no lane it returns the URL. With one it checks the base URL is a `_test` database, checks the lane is a slug, rewrites `<name>_test` to `<name>_<lane>_test`, refuses a name longer than the 63 bytes Postgres keeps (the truncation would cut off the `_test` suffix), checks the guard again on the result, and returns a URL already on the lane unchanged so nothing stacks it twice. It is a pure module so `tooling/env.ts` can use it without importing the destructive entry point.
- `@repo/db`: `readTestDatabaseUrl` and `readTestOwnerDatabaseUrl` apply `TEST_DB_LANE` (new `readTestDbLane`), so every reader in the tier follows the lane, and so does `db:migrate --test`. `packages/db/.env.test` is committed in the API file's shape (`NODE_ENV=test`, the two test URLs, and the superuser URL, which `db:lane` alone reads). `packages/db/vitest.int.config.ts` loads it with `parseEnv` into `test.env`, which reaches every forked worker over the shell — the precedence `override: true` gives the API's file.
- `apps/api/test/setup/env.ts`: `readTestUrl` applies `laneDatabaseUrl` to `DATABASE_URL_TEST` and `DATABASE_URL_TEST_OWNER` after `.env.test` loads, and to `DATABASE_URL_TEST_SUPERUSER` too, so `database-role.int.test.ts` reads the schema the run built. The `_TEST` variables are never rewritten in `process.env`; only `DATABASE_URL`/`DATABASE_URL_OWNER` carry the lane's URL.
- `scripts/db-lane.mjs` (`pnpm db:lane`, no argument): slugs `git branch --show-current` (`lane/` dropped, lower-cased, runs of anything else one hyphen, trimmed, capped at 40), refuses `main` and a detached HEAD, reads the URLs from `packages/db/.env.test`, creates `machxi_<slug>_test` as the superuser with `machxi_test`'s owner (`datdba`) and the init script's grants, hands `public` to the owner, and prints the slug on stdout. `export TEST_DB_LANE=$(pnpm --silent db:lane)` is the whole of it. It is idempotent: a second run reports "already there" and re-applies the grants, and a lost create race (`42P04`) is taken as done. `postgres` is resolved from `@repo/db` rather than added to the root.
- `turbo.json`: `TEST_DB_LANE` in `env` for `test` and `test:int`. `.env.example` names it, commented out, and the superuser comment names `db:lane` as its second reader. The digest's API-and-data area gains "A test database per lane" (0082, 0021, 0007, 0004); `pnpm rules:digest` wrote 1 of 3. `/local-dev` gains "A lane's test database" and a troubleshooting row for a lane whose database does not exist.

**Amended against the plan (labelled here, not in the record).** The plan says "both test URLs". The API harness also rewrites the superuser's URL, the third it hands out: otherwise the one file that reads it would query `machxi_test`'s schema while the run built the lane's. `TEST_DB_LANE` holds the slug, not the branch name — `db:lane` prints it and the harness refuses anything that is not one — so the slug rule lives in `scripts/db-lane.mjs` alone.

**Tests.**

- `apps/api/test/setup/env.test.ts`: "rewrites both test URLs to the lane database when TEST_DB_LANE is set", "leaves both URLs alone when TEST_DB_LANE is unset", "refuses a lane that is not a branch slug". The names are read from the committed file, so a renamed clone keeps them.
- `packages/db/src/__tests__/testing.test.ts`: "a lane database still has to end in _test", plus the rewrite keeping credentials/host/query, no lane, no double stacking, a non-slug refused, an overlong name refused.
- `scripts/db-lane.test.mjs`: "lane/D29 slugs to d29", "spike/d29-rls slugs to spike-d29-rls", "main is refused", plus a detached HEAD, a cloud branch, collapsing, the cap and stability on its own output.

**Done-whens.**

- The three named test files' cases: green (in `pnpm check` and in the gate).
- `pnpm test:int --filter api` with `TEST_DB_LANE` set: green, 29 files / 847 tests, and the run's log reads `db:migrate → localhost:5432/machxi_claude-nifty-planck-bnxu4s_test`. **This branch's slug is `claude-nifty-planck-bnxu4s`, database `machxi_claude-nifty-planck-bnxu4s_test`**, created on the session's local Postgres by `pnpm db:lane` (a second run: "already there").
- `pnpm test:int --filter @repo/db` from this clone with **no root `.env` and nothing exported** (no `DATABASE_URL_TEST*` in the shell, `TEST_DB_LANE` unset): green, 6 files / 128 tests, on `machxi_test`. With `TEST_DB_LANE` set it is green on the lane's database. The earlier cloud steps' exports of `.env.example`'s values are no longer needed for either tier, and the gate below ran without them.
- `pnpm check`: green (39 + 17 tasks).

**Gate**, with `TEST_DB_LANE=claude-nifty-planck-bnxu4s` and nothing else exported, never `--force`:

- `pnpm lint`: pass (22 tasks; `test:scripts` and `docs:check` inside it).
- `pnpm check-types`: pass (17 tasks).
- `pnpm test`: pass (17 tasks). `api` 51 unit files / 835 tests, 29 int files / 847 tests; `@repo/db` 124 unit, 6 int files / 128 tests. Every `db:migrate →` line in the log names `machxi_claude-nifty-planck-bnxu4s_test`.
- `pnpm size`: pass (4 tasks).
- `pnpm format:check`: pass.

**Review.** **Owed.** This builder session had no Agent tool, so it could not run the one bounded review (`adr-reviewer` or `code-reviewer`) in a fresh context. By ADR-0082 §2 the builder's own reading does not count as the review, so none is recorded here. The orchestrating session runs the one review over this step's commit before `D34.2`, and its findings and their fates go in the next note or in a fix-forward commit.

**Pending the operator.** Nothing is browser-only. CI state for the pull request was not read in this step, because steps 1–4 close on the local gate. Draft PR #2's `gate.yml` run on this push is the first CI proof of the lane's database code on a runner, where `TEST_DB_LANE` is unset and the tiers run on `machxi_test`.
