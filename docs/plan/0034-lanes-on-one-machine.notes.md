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

**Gate**, over the diff before the review, with `TEST_DB_LANE=claude-nifty-planck-bnxu4s` and nothing else exported, never `--force`:

- `pnpm lint`: pass (22 tasks; `test:scripts` and `docs:check` inside it).
- `pnpm check-types`: pass (17 tasks).
- `pnpm test`: pass (17 tasks). `api` 51 unit files / 835 tests, 29 int files / 847 tests; `@repo/db` 124 unit, 6 int files / 128 tests. Every `db:migrate →` line in the log names `machxi_claude-nifty-planck-bnxu4s_test`.
- `pnpm size`: pass (4 tasks).
- `pnpm format:check`: pass.

**Review.** **Owed.** This builder session had no Agent tool, so it could not run the one bounded review (`adr-reviewer` or `code-reviewer`) in a fresh context. By ADR-0082 §2 the builder's own reading does not count as the review, so none is recorded here. The orchestrating session runs the one review over this step's commit before `D34.2`, and its findings and their fates go in the next note or in a fix-forward commit.

**Pending the operator.** Nothing is browser-only. CI state for the pull request was not read in this step, because steps 1–4 close on the local gate. Draft PR #2's `gate.yml` run on this push is the first CI proof of the lane's database code on a runner, where `TEST_DB_LANE` is unset and the tiers run on `machxi_test`.

### D34.1 — the review, and its findings' fates

**The one review** was run by the orchestrating session: `code-reviewer` over `6d70e01`, in a fresh context. It found the core sound: no path rebuilds a non-`_test` database, only the URL's pathname is rewritten, `ident()` quotes safely, the grants match `01-test-db.sql`, and `db:lane` is idempotent. It reported four correctness findings. Each was checked against the code, all four were confirmed, and all four are fixed in the follow-up commit `fix(db,scripts): D34.1 follow-up — the review's findings`.

1. **An empty `TEST_DB_LANE` was read as `machxi_test`. Fixed.** When `db:lane` fails, `export TEST_DB_LANE=$(pnpm --silent db:lane)` exports `""`, and that shell's integration runs would then rebuild the shared `machxi_test`. `laneDatabaseUrl` now returns the URL only for `undefined` and refuses a lane that is set but empty or blank ("TEST_DB_LANE is set but empty; re-run … or unset it"). `readTestDbLane` reads `process.env.TEST_DB_LANE` raw instead of through `read()`, which turned `""` into unset, and the API harness passes the value untrimmed. Tests: `testing.test.ts` "refuses a lane that is set but empty rather than reading it as unset" replaces the case that asserted the fallback, and `env.test.ts` adds "refuses a lane that is set but empty". Observed: `TEST_DB_LANE= pnpm test:int --filter @repo/db` exits 1 with that message.
2. **Branches that differ only past the 40-character cut shared a slug. Fixed, hash on truncation only.** A slug over the cap now keeps its first 33 characters (trailing hyphens trimmed), a hyphen, and the first 6 hex characters of the sha1 of the whole branch name. For example, `spike/d29-row-level-security-for-organizations-v1` becomes `…-for-b5380d` and `-v2` becomes `…-for-cf075b`. A slug that fits carries no hash, so the done-whens hold as written: `lane/D29` → `d29`, `spike/d29-rls` → `spike-d29-rls`, and this branch is still `claude-nifty-planck-bnxu4s`. Case folding and dropping `lane/` still merge `lane/D29`, `lane/d29` and `d29` into one lane. That is left as designed: those names mean the same lane, and hashing them would break the plan's `lane/D29` → `d29`. `lane/main`, which slugs to `main`, is now refused. Tests: "truncated slugs of branches that differ past the cut differ", "a slug that fits carries no hash", "a truncated slug ends in the hash, with one hyphen before it", "lane/main is refused".
3. **`db:migrate --test` through turbo never saw the lane. Fixed.** Strict env mode stripped `TEST_DB_LANE`, so this step's first note was wrong to say that path follows the lane. `turbo.json`'s `db:migrate` `env` now declares `DATABASE_URL_TEST_OWNER` and `TEST_DB_LANE`. `turbo run db:migrate --filter @repo/db --dry=json` lists the task's specified env as `ARGON2_*, DATABASE_URL, DATABASE_URL_OWNER, DB_*, SEED_SUPER_ADMIN_*` before the fix and `ARGON2_*, DATABASE_URL, DATABASE_URL_OWNER, DATABASE_URL_TEST_OWNER, DB_*, SEED_SUPER_ADMIN_*, TEST_DB_LANE` after it.
4. **`db-lane.mjs` could create a database whose name Postgres truncates. Fixed.** `laneDatabaseName` refuses a name over 63 bytes, the same refusal the harness makes, so a long fork base plus a 40-character slug is refused before `create database`, not truncated to a stray `…_tes`. Test: "refuses a name longer than Postgres keeps" (a base of 18 characters plus 40 is 64 bytes).

**Checks after the fix**, never `--force`:

- `pnpm check`: pass (39 + 17 tasks).
- `pnpm test:scripts`: pass (90 tests).
- `pnpm format:check`: pass.
- `pnpm test:int --filter @repo/db` with `TEST_DB_LANE=claude-nifty-planck-bnxu4s`: pass, 6 files / 128 tests, on `machxi_claude-nifty-planck-bnxu4s_test`.
- `pnpm test:int --filter api`, same lane: pass, 29 files / 847 tests, on the same database.

I did not re-run the whole gate. The changes are confined to the two harness readers, the script and `turbo.json`, and the checks above cover them.

## D34.2 — The step check, the lock, and the permissions (2026-09-30)

Built in a cloud session on the lane branch `claude/nifty-planck-bnxu4s` (PostgreSQL 16 on localhost:5432, no Docker, no dev stack, no root `.env`), committed and pushed there as one commit; not merged to `main` (plan §Constraints). The builder session's permission classifier refused its own edit to `.claude/settings.json`. The operator then authorized that edit, and the orchestrating session applied it; it is in this step's commit.

**Moved at this step.** [ADR-0026](../adr/0026-task-graph-caching-and-serialisation.md) and [ADR-0050](../adr/0050-adr-lifecycle-and-verification.md) → `superseded by` [ADR-0082](../adr/0082-lanes-on-one-machine-and-one-main.md), each with its delta on the status line and a head note. 0026's delta covers §The fast loop and the third paragraph of §The rule. 0050's covers §Verification item 1 alone. Also updated: the index rows for 0026, 0050 and 0082; the topic table's rows for recording decisions and for the task graph; the ledger's running paragraph. The process digest gains "The step check and the lock" (0082, 0026, 0050), and `pnpm rules:digest` wrote 1 of 3, then 0 of 3.

**Built.**

- `scripts/with-lock.mjs`: `with-lock <name> [--timeout <s>] -- <command…>`.
  - The lock is a directory at `<git common dir>/machxi-locks/<name>.lock`. It is built under a private name with its `holder.json` inside, then renamed into place, so a reader never sees a lock without its holder.
  - A waiter prints the holder (pid, host, command, branch, checkout, since) once per holder.
  - A holder whose pid is gone on this host is taken over, one waiter at a time. The taker first claims the stale directory by creating `takeover` inside it (an atomic `mkdir`), re-reads the holder under the claim, and removes the directory only if it is still the stale one. A claim older than 30 s, left by a waiter that died holding it, is cleared (review finding 3).
  - A timeout (one hour by default) exits 1, names the holder, and does not run the command.
  - `MACHXI_LOCKS_HELD` makes a nested call for a held lock run at once, so the gate run under the lock at ship reaches `pnpm test` and `pnpm size` without deadlocking.
  - Ctrl-C reaches the child from the process group and the wrapper stays up to release the lock. A SIGTERM is forwarded.
- Root `package.json`: `test`, `test:int`, `size` and `test:e2e` run inside `with-lock tiers --`. `step:check` is `node scripts/step-check.mjs`.
- `scripts/step-check.mjs` (`pnpm step:check [--base <ref>]`), in this order:
  - `pnpm check`.
  - `turbo run test:int size --filter=...[<base>] --dry=json`, to learn which packages with a real `test:int` and which SPAs' `size` the change reaches. `<base>` is `git merge-base origin/main HEAD`.
  - Under the `tiers` lock, for each reached package: `vitest run --config <its test:int config> --changed <base> --passWithNoTests` with a JSON report. When the diff (`git diff --name-only <base>` plus untracked files) touches what the tier is built from rather than what a test imports, `--changed` is dropped and every integration file of the reached packages runs. Those paths are `INTEGRATION_TRIGGERS`: a manifest, the lockfile, a vite or vitest config, an `.env.test`, `test/setup/`, `packages/config-vitest/`, `packages/db/migrations/`, and the db harness modules (review finding 1).
  - A failed file is first re-run in its set, with the run's own arguments. Failing there again makes it the step's failure (review finding 2). Otherwise it is re-run alone: passing alone twice makes it a FLAKE, named in the summary, and failing alone makes it the step's failure. A red run, or a red set re-run, that failed no file is a failure, never a flake.
  - `pnpm size` when an SPA is reached.
  - `pnpm format:check`.
  - It ends on `ran` and `skipped` lines. It warns when `TEST_DB_LANE` is unset.
- `CLAUDE.md` §Commands:
  - The step check and the gate are each defined once: `# THE STEP CHECK` over `pnpm step:check`, `# THE GATE` over the five links.
  - The lock and "never `--force`" are one sentence.
  - Rule 3 reads "A step ends green on the step check, a lane on the gate."
  - The file is capped under 6 KB and was 4 bytes under it, so the running-stack, search, digest, workflow-1 and subagents paragraphs were shortened, keeping what they say, to fit (6132 bytes).
- `scripts/docs-hygiene.test.mjs` "the first link carries every check that can go red": the predicate would have demanded `//#step:check` in `lint`'s `dependsOn`, since it is a root `*:check` that is not a `turbo run` launcher. It now reads the step check from `CLAUDE.md` beside the gate and excludes it, because the step check runs the first link rather than being a check inside it.
- `gate-runner`: `Bash(pnpm step:check*)` added to its tools. Its "Which command" section gains the step check (a FLAKE keeps RESULT at PASS), the gate is now "before a lane ships", `--force` is never added, and a lock timeout is `BLOCKED`, never a lock removed.
- `.claude/README.md`: a bullet on the step check, the lock and `TURBO_CACHE_DIR`. A worktree may point it at `$(git rev-parse --path-format=absolute --git-common-dir)/turbo-cache`, one cache for every checkout of the clone, and a hit from there is correct under ADR-0026's purity rule.

**Amended against the plan.**

- **The grid done-when is amended in place, labelled.** `apps/customer` does not depend on `@repo/grid`, so a grid-only branch puts `@repo/grid` and `admin` in scope, not "the two SPAs". The step-check case's fixture follows turbo's real answer.
- **`test` is locked too**, beside the plan's `test:int`, `size` and `test:e2e`. It runs the integration tier, and it is the link the gate runs.
- **"A named lock directory beside the checkouts" is read as the git common directory.** It is the one place every worktree of a clone shares, wherever the worktree sits, including `.claude/worktrees/`, and it is never tracked. Separate clones of the repository do not share it.

**Tests.** `scripts/with-lock.test.mjs`:

- "a second holder waits until the first releases"
- "a lock whose holder is gone is taken over"
- "a timeout is reported, not skipped" (in-process and through the command line: exit 1, and the command's marker file is never written)
- a live holder is not gone
- the command runs holding the lock and keeps its exit code
- "a takeover another waiter has claimed is left to it" and "a claim left by a waiter that died is cleared, and the lock taken" (review finding 3)
- a nested call runs at once
- argument parsing

The command-line cases run with `MACHXI_LOCKS_HELD` emptied (review finding 4), and the file is green with `MACHXI_LOCKS_HELD=tiers` exported, as it is when the gate runs under the lock at ship.

`scripts/step-check.test.mjs`, with `turbo` and `vitest` stubbed at the `exec` seam and the lock at its own:

- "a change under apps/api runs the api's integration files that import it and no other package's"
- "a change under packages/grid runs size and no integration file"
- "a documents-only change runs the fast loop and format:check alone"
- "a failed file that passes alone twice is reported as a flake"
- "a failed file that fails alone is a failure"
- "a file that fails in its set twice and passes alone is a failure, not a flake" (review finding 2)
- "a migration-only change runs every integration file of the packages it reaches" (review finding 1)
- the trigger paths, and only those, name a blind `--changed`
- a pass-then-fail re-run is a failure
- a red run with no failed file is a failure
- a red fast loop stops the check
- configs read from each `test:int` command
- failed files named relative to their package

**Done-whens.**

- The three `with-lock` cases and the five `step-check` cases: green.
- `pnpm turbo run lint check-types test:unit --filter="...[$(git merge-base origin/main HEAD)]"` on a branch that changes only `@repo/grid`: a scratch worktree from `origin/main` with one comment appended to `packages/grid/src/bulk-summary.ts` and committed; removed afterwards. Turbo: "Packages in scope: @repo/grid, admin", 30 tasks, 30 successful.
  - The task list is `//#docs:check`, `//#test:scripts`, `admin#check-types`, `admin#i18n:check`, `admin#lint`, `admin#test:unit`, `@repo/grid#check-types`, `@repo/grid#lint`, `@repo/grid#test:unit`, and, through `^lint` and `^check-types`, the lint and check-types of admin's workspace dependencies: account, api-client, app-kit, app-services, contracts, eslint-config (lint only), form, i18n, resource, ui and vitest-config.
  - Nothing under `apps/api` ran, and nothing of `customer`.
- `pnpm docs:check`: clean.
- `pnpm test:scripts`: green, 107 tests.
- `pnpm check`: green, inside the step check below.

**`pnpm step:check` on this step's diff before the review**, with `TEST_DB_LANE=claude-nifty-planck-bnxu4s`, base `d518b5938943` (`git merge-base origin/main HEAD`):

```
step:check against d518b5938943b56fafbb726ae37fa268a77b4efe
  ran      check
  ran      integration @repo/db (--changed d518b5938943)
  ran      integration api (--changed d518b5938943)
  ran      size (admin, customer)
  ran      format:check
step:check ✓
```

- `check`: 39 tasks, 5 cached, all successful, followed by `test:unit`.
- The diff changes the root `package.json`, which turbo treats as a global input, so its filter reached every package. The root `package.json` also matches vitest's default `forceRerunTriggers`, so `--changed` chose every integration file: `@repo/db` 6 files / 128 tests, `api` 29 files / 847 tests, every `db:migrate →` line on `machxi_claude-nifty-planck-bnxu4s_test`. Both JSON reports were written.
- `size` was FULL TURBO.

That is the right answer for a change to the root manifest, not a sign that `--changed` does not narrow. A narrower diff is what the stubbed cases pin. The per-package file count in the `ran` line was added after this run.

The review later showed why that answer was right, and where it would not have been. Vitest matches `forceRerunTriggers` against absolute paths with picomatch, whose `**` does not cross a dot-directory. In a lane worktree under `.claude/worktrees/`, then, not even its default `**/package.json` matches: `/r/package.json` → true, `/r/.claude/worktrees/x/package.json` → false (picomatch 4.0.7). The triggers now live in `step-check.mjs`, over repo-relative paths.

**Gate**, with `TEST_DB_LANE=claude-nifty-planck-bnxu4s` and nothing else exported, never `--force`:

- `pnpm lint`: pass (22 tasks, 2 cached; `test:scripts` 107 tests and `docs:check` inside it).
- `pnpm check-types`: pass (17 tasks).
- `pnpm test`: pass (17 tasks, 0 cached), run as `node scripts/with-lock.mjs tiers -- turbo run test --concurrency=1`. `api` 51 unit files / 836 tests and 29 int files / 847 tests; `@repo/db` 7 unit files / 125 tests and 6 int files / 128 tests. Every `db:migrate →` line names `machxi_claude-nifty-planck-bnxu4s_test`.
- `pnpm size`: pass (4 tasks, 4 cached), inside the lock.
- `pnpm format:check`: pass.

**Review.** One bounded pass: `code-reviewer` over the uncommitted diff, run by the orchestrating session in a fresh context, because this builder had no Agent tool. The builder checked each finding against the code.

1. **A schema-only step passed with no integration file run. Confirmed; fixed.** `--changed` follows import edges. Vitest's default triggers are `**/package.json` and `**/{vitest,vite}.config.*`, plus the setup files, not the global setup. So a diff of migrations and `_journal.json` alone reached `@repo/db` and `api` through turbo, selected 0 files, never replayed the migrations, and went green under `--passWithNoTests`. The same was true of the harness, `.env.test`, `vitest.int.config.ts` and `packages/config-vitest`.
   - Fixed in `step-check.mjs` rather than in `integrationConfig`'s `forceRerunTriggers` (the other option offered). As measured above, vitest's own trigger matching is blind in a `.claude/worktrees/` lane.
   - Test: "a migration-only change runs every integration file of the packages it reaches".
2. **An order-dependent failure was reported as a flake. Confirmed; fixed on the orchestrating session's decision to tighten.** A failed file is first re-run in its set with the same arguments, and failing there again is a failure.
   - [ADR-0082](../adr/0082-lanes-on-one-machine-and-one-main.md) §2 is amended in place, labelled `**Amended 2026-09-30 (D34.2).**`. The amendment adds the set re-run and the rule that a change to what the tier is built from runs every file.
   - The process digest's line and `gate-runner`'s FLAKE wording follow it.
   - Test: "a file that fails in its set twice and passes alone is a failure, not a flake".
3. **The lock takeover raced. Confirmed; fixed.** Two waiters that read one dead holder could each move a directory aside, the slower one moving the faster one's live lock. A third waiter could take the gap, leaving two holders running. The takeover is now claimed first, by an atomic `mkdir` inside the stale directory, and the holder is re-read under the claim; see §Built. Tests: the claimed-takeover and dead-claim cases.
4. **The command-line tests went red under a held lock. Confirmed; fixed.** Both `spawnSync` calls inherited `MACHXI_LOCKS_HELD`, so under a ship-wide lock the timeout case ran its command and the exit-code case exited 9. Both now pass `MACHXI_LOCKS_HELD: ""`. The file is green with `MACHXI_LOCKS_HELD=tiers` exported.
5. **Liveness is judged by hostname and pid. Accepted, not fixed.** A holder on another host, or a recycled pid, reads as alive, so the waiter waits to the timeout and is told who holds the lock. The failure is closed: never two holders, at worst a wait. The timeout message names the holder, so the operator can remove it.

The reviewer also noted that `.claude/skills/step/SKILL.md` still says a step ends green on the gate. By the plan that is `D34.5`'s, which adopts the step check in `/step` and `/steps`, so it is left as is.

**Checks after the review fixes**, with `TEST_DB_LANE=claude-nifty-planck-bnxu4s`, never `--force`. `packages/config-vitest` was not changed, so no integration tier is reached through it. The step check below ran the integration tier of both packages whole, because this diff changes the root `package.json`, a trigger.

- `node --test scripts/with-lock.test.mjs`: 9 pass, with `MACHXI_LOCKS_HELD` unset and again with it set to `tiers`. `node --test scripts/step-check.test.mjs`: 13 pass.
- `pnpm docs:check`: clean. `pnpm rules:digest`: wrote 1 of 3, then 0 of 3.
- A first `pnpm step:check` over the fixed tree ran `check` (39 tasks), both integration tiers whole — "(every file: apps/api/test/setup/env.test.ts changed)", `@repo/db` 6 files / 128 tests and `api` 29 / 847 — and `size`. It then went red on `format:check` alone, over this notes file, which was being edited while it ran (a missing blank line before a list). The trigger it names is `D34.1`'s: the base is the lane's merge base with `main`, so the whole lane's diff counts.
- **`pnpm step:check` on the final diff:**

```
step:check against d518b5938943b56fafbb726ae37fa268a77b4efe
  ran      check
  ran      integration @repo/db (every file: apps/api/test/setup/env.test.ts changed): 6 file(s)
  ran      integration api (every file: apps/api/test/setup/env.test.ts changed): 29 file(s)
  ran      size (admin, customer)
  ran      format:check
step:check ✓
```

`check`: 39 tasks and then `test:unit`'s 17, all successful. Integration: `@repo/db` 6 files / 128 tests and `api` 29 files / 847 tests, every `db:migrate →` line on `machxi_claude-nifty-planck-bnxu4s_test`. `size`: FULL TURBO. `format:check`: pass. After it, only this bullet was written; `pnpm format:check` and `pnpm docs:check` were re-run over it.

**Pending the operator.** Nothing is browser-only. CI state for the pull request was not read in this step: steps 1–4 close on the local gate, and the pull request's `gate.yml` run on this push is its CI proof.

- **`CLAUDE.md` was edited** as this step's plan requires: §Commands, rule 3, and trims to fit its 6 KB cap. The operator should read that diff.

## D34.3 — `merge=ours` scoped to the starter merge; union for notes and the changelog (2026-09-30)

Built in a cloud session on the lane branch `claude/nifty-planck-bnxu4s` (PostgreSQL 16 on localhost:5432, no Docker, no dev stack, no root `.env`), committed and pushed there as one commit; not merged to `main` (plan §Constraints).

**Moved at this step.** [ADR-0065](../adr/0065-starter-lifecycle.md) → `superseded by` [ADR-0082](../adr/0082-lanes-on-one-machine-and-one-main.md) for §3's mechanism, and [ADR-0081](../adr/0081-build-versions.md) → `superseded by` 0082 for one sentence of §5, each with its delta on the status line and a head note, bodies untouched. The index rows for 0065, 0081 and 0082, the topic table's forking row, the index's "starter as a starter" note, the ledger's lane entry (0081 added) and its running paragraph say so. The process digest's "Forking" line now cites 0082 and says how the journal is kept; `pnpm rules:digest` wrote 3 of 3 (0065 and 0081 are carried in all three areas' citations), then 0 of 3.

**Built.**

- `.gitattributes`: `docs/plan/** merge=ours`, then `docs/plan/*.notes.md merge=union` and `docs/CHANGELOG.md merge=union` (a later line wins), and a comment that says what each merge does with them and that no clone or global config may define `merge.ours.driver`. `git check-attr merge` reads `ours` for the ledger and the plans, `union` for the notes and the changelog.
- `docs/forking.md` §5: the starter merge is `git -c merge.ours.driver=true -c merge.union.driver=true merge starter/main`, with a paragraph on why it is the only merge that keeps the journal, the warning against a defined driver, and what still arrives (a plan the starter adds) or conflicts (modify/delete on a plan the fork deleted — observed in a scratch repository). §2's two journal bullets and the "What conflicts" table point at §5 instead of `merge=ours`.
- `/bootstrap`: keeps the attributes, defines no driver, names the starter merge; its acceptance reads `merge: ours` for the ledger, `merge: union` for the changelog, and no `merge.ours.driver` in the config. Its description line follows.
- `docs/CHANGELOG.md`'s preamble: kept by the starter merge's command line, `union` between lanes.
- `scripts/merge-attributes.test.mjs` (picked up by `pnpm test:scripts`): each case a repository under `os.tmpdir()`, removed in `after`, carrying this clone's committed `.gitattributes`, with `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` so no machine-wide driver can make a case pass, and `user.name`/`user.email`/`commit.gpgsign` set per repository. The starter-merge case reads the command's `-c` flags from `docs/forking.md` and requires `/bootstrap` to name the same command.

**Amended against the plan and the record, labelled in both.** The plan said `.gitattributes` drops `docs/plan/** merge=ours` and the starter merge is `git -c merge.ours.driver=true merge starter/main`. Git runs a merge driver only for a path whose `merge` attribute names it (a scratch repository: with no attribute naming `ours`, the flag changes nothing), so that pair keeps nothing, and the done-when "the starter merge with the driver on the command line keeps ours" could not pass as scoped. What goes is the standing _driver_, not the attribute: an attribute naming a driver no config defines falls back to git's text merge (observed: `CONFLICT (content)`, no warning), so the ledger conflicts in a lane merge exactly as the plan wants. And with the changelog on the built-in `union`, `-c merge.ours.driver=true` alone would have let the starter's changelog entries into a fork, undoing [ADR-0081](../adr/0081-build-versions.md) §5 (the changelog is journal); git looks a driver up in the config before its built-in `union` (observed), so the command also defines `merge.union.driver=true`. 0082 §4 is amended in place, labelled `**Amended 2026-09-30 (D34.3).**`; its header's supersedes list gains 0081 §5 and its title "0065 and 0081"; the plan's step 3 and its Records line are amended, labelled. **The command differs from the one the plan and the step's brief named** — the operator should read 0082 §4's amendment.

**Tests.** `scripts/merge-attributes.test.mjs`:

- "a lane merge keeps both sides of a notes file"
- "a lane merge keeps both sides of the changelog"
- "a lane merge of the ledger conflicts rather than dropping a side"
- "the starter merge with the driver on the command line keeps ours" — the fork's ledger, changelog and notes kept byte for byte, the starter's code change taken, and the same merge without the flags conflicting
- "the journal names ours, the notes and the changelog union" (`git check-attr`)

A mutant with every `merge=union` read as `merge=ours` fails the attribute case and both union cases, so they test the attribute rather than git's defaults.

**Done-whens.**

- The four named cases: green (5 of 5 in the file).
- `pnpm docs:check`: clean ("inherited documents: clean", "open lanes: disjoint (1 open)", "tag prefix: starter").
- `pnpm test:scripts`: green, 117 tests.

**Gate**, over the whole diff, with `TEST_DB_LANE=claude-nifty-planck-bnxu4s` and nothing else exported, never `--force`:

- `pnpm lint`: pass (22 tasks, 0 cached; `test:scripts` 117 tests and `docs:check` inside it).
- `pnpm check-types`: pass (17 tasks).
- `pnpm test`: pass (17 tasks, 0 cached, 8m59s, under the `tiers` lock). `api` 51 unit files / 836 tests and 29 int files / 847 tests; `@repo/db` 7 unit files / 125 tests and 6 int files / 128 tests; `admin` 54 files / 335 tests; `customer` 39 files / 287 tests. All 23 `db:migrate →` lines name `machxi_claude-nifty-planck-bnxu4s_test`.
- `pnpm size`: pass (4 tasks).
- `pnpm format:check`: pass.

**Review.** **Owed.** This builder session had no Agent tool, so it could not run the one bounded review in a fresh context; by ADR-0082 §2 its own reading is not the review, and none is recorded here. The orchestrating session runs it over this step's commit — `adr-reviewer` fits, the step being record-heavy — and a confirmed finding is fixed in a `D34.3` follow-up commit, noted below.

**Pending the operator.** Nothing is browser-only. CI state was not read (steps 1–4 close on the local gate); the pull request's `gate.yml` run on this push is its CI proof. **Read 0082 §4's amendment**: the starter merge now defines two drivers, `-c merge.ours.driver=true -c merge.union.driver=true`, where the plan named one, and 0081 §5 joined the lane to say so.

**`pnpm step:check` on the final tree** (everything above written), with `TEST_DB_LANE=claude-nifty-planck-bnxu4s`, base `d518b5938943` (`git merge-base origin/main HEAD`), exit 0:

```
step:check against d518b5938943b56fafbb726ae37fa268a77b4efe
  ran      check
  ran      integration @repo/db (every file: apps/api/test/setup/env.test.ts changed): 6 file(s)
  ran      integration api (every file: apps/api/test/setup/env.test.ts changed): 29 file(s)
  ran      size (admin, customer)
  ran      format:check
step:check ✓
```

`check`: 39 tasks (5 cached) and then `test:unit`'s 17, all successful. The base is the lane's merge base, so the whole lane's diff counts, and `D34.1`'s harness change is a trigger: both integration tiers ran whole, every `db:migrate →` line on `machxi_claude-nifty-planck-bnxu4s_test`. After it only this paragraph was written; `pnpm format:check` and `pnpm docs:check` were re-run over it.

### D34.3 — the review, and its findings' fates

**The one review** was run by the orchestrating session: `adr-reviewer` over `87714e6`, in a fresh context. It checked every git claim and found each one true: a driver no config defines falls back to the text merge, the later `.gitattributes` line wins on the notes files, `-c merge.union.driver=true` overrides the built-in `union`, and a repeat starter merge keeps the fork's side. It then found three issues in the records and documents around that mechanism. All three are fixed in the follow-up commit `fix(docs,scripts,adr): D34.3 follow-up — the review's findings`.

1. **[MAJOR] ADR-0082 still stated the rule its amendment withdrew. Fixed.**
   - The header's 0065 §3 delta read "never as a standing attribute a lane merge would hit". It is now struck, and the replacement says the standing driver goes and the attribute stays, inert without one.
   - §4's sentence "The `docs/plan/** merge=ours` attribute is removed; the starter merge applies the driver on the command line …" is struck with `~~` under the existing D34.3 label, which now says it replaces the struck sentence.
   - The plan's Constraints line "`merge=ours` is applied on the command line … not as a standing attribute" is struck, labelled, and restated: the drivers are defined on the command line, and the attribute stays.
2. **[MINOR] The warning named only `merge.ours.driver`. Fixed.** `.gitattributes`, `docs/forking.md` §5, 0082 §4 and `/bootstrap` now warn about both drivers. A `merge.union.driver` in a clone's or a global config would make every lane merge keep its own notes and changelog. `/bootstrap`'s acceptance now requires `git config --get-regexp '^merge\.(ours|union)\.driver$'` to print nothing.
   - New case in `scripts/merge-attributes.test.mjs`: "a union driver defined in the clone makes a lane merge drop a side". With `merge.union.driver=true` in the repository's config, a lane merge of the changelog exits 0 and loses the lane's entry.
3. **[MINOR] Nothing enforced "appends only" on the union files. Fixed on the orchestrating session's decision.**
   - 0082 §4's D34.3 amendment now says the changelog's preamble and a notes file's existing text are edited only by the lane that ships. `.gitattributes`, `docs/forking.md` §5 and the process digest's "Forking" line say the same; `pnpm rules:digest` wrote 1 of 3, then 0 of 3.
   - `scripts/docs-hygiene.mjs` gains `checkUnionJournal` and `scanUnionJournal`. `pnpm docs:check` now refuses a `docs/CHANGELOG.md` with a repeated title, a repeated preamble paragraph (keyed by its first 40 characters, so a copy edited apart after its opening still counts) or a repeated `## ` heading. It refuses a `docs/plan/*.notes.md` with a repeated `#`, `##` or `###` heading. Fenced code is not read. It prints "union journal: no passage twice".
   - The change is kept to one function, its scan and one line in the entry point, because `D34.4` rewrites other parts of the file.
   - Tests in `scripts/docs-hygiene.test.mjs`: "a changelog whose preamble or an entry's heading appears twice is refused", "a notes file with a duplicated section heading is refused", and "this repository's changelog and notes repeat no passage" (the live tree).

**Checks after the fix**, with `TEST_DB_LANE=claude-nifty-planck-bnxu4s`, never `--force`. No package changed, so the whole gate was not re-run (the orchestrating session's instruction):

- `pnpm test:scripts`: pass, 121 tests. `merge-attributes.test.mjs` 6, and `docs-hygiene.test.mjs` 54.
- `pnpm docs:check`: clean, "union journal: no passage twice".
- `pnpm rules:digest`: 0 of 3 on two further runs.
- `pnpm format:check`: pass.
- `pnpm check`: pass. 39 tasks (0 cached; `test:scripts` and `docs:check` inside `lint`), then `test:unit`'s 17.

## D34.4 — Lane entries as files; the running paragraph generated; tiers (2026-09-30)

Built in a cloud session on the lane branch `claude/nifty-planck-bnxu4s` (PostgreSQL 16 on localhost:5432, no Docker, no dev stack, no root `.env`), committed and pushed there as one commit; not merged to `main` (plan §Constraints).

**Moved at this step.** [ADR-0079](../adr/0079-parallel-lanes.md) → `superseded by` [ADR-0082](../adr/0082-lanes-on-one-machine-and-one-main.md) for §2, with its delta on the status line and a head note; the body is untouched. §4's delta waits for `D34.5`, as 0082's header says. The index rows for 0079 and 0082 and the topic table's deliverables row ("with 0079 as carried by 0082") say so. The process digest's "The window" line now says the section links one file per open lane, and a new line, "Lane files and tiers" (0082, 0079), states the shape; `pnpm rules:digest` wrote 1 of 3, then 0 of 3.

**Built.**

- `docs/plan/lanes/D34.md`: D34's lane entry, moved out of the window section. Deliverable and plan, `Opened: 2026-09-30`, `Branch: claude/nifty-planck-bnxu4s` (0082 §1), `Tier: package` (the plan's `- Tier:` line), `Schema: no`, and the ten records the entry listed at `D34.3`'s close: 0082, 0079, 0059, 0050, 0026, 0021, 0007, 0004, 0065, 0081. D29 and D32 had shipped, so no other entry moved.
- `scripts/lanes.mjs` (`pnpm lanes`):
  - `parseLaneFile` reads one file's six `- Key: value` fields. A misspelt, missing or repeated field is refused, as are a deliverable that is not the one the file is named for, an undated `Opened`, an unquoted branch, a tier outside `package | api | schema`, and a record that is not a `[NNNN](../../adr/NNNN-….md)` link whose label matches its file. Prose lines are not read.
  - `renderLanes` writes the block: one list item per lane, linking the plan and the lane file, and the running paragraph. The paragraph says which lanes are open, that their records are amendable and every other record closed, which lane owns the schema, and the lanes by tier. It is rendered from the files alone.
  - The block sits between two HTML-comment markers in the window section. `pnpm lanes` rewrites only what is between them, writes nothing when it is current, and writes nothing at all when a lane file does not parse.
- `scripts/docs-hygiene.mjs`: `parseLanes(ledger, laneFiles)` and `checkLanes({ ledger, laneFiles, readPlan })` read the files instead of the list.
  - Kept: a shared record, a second schema lane, a file that does not parse, a table row `in progress` without a file (`lane-missing`) and a file for a row that is not (`lane-not-open`). A violation names the lane file and the field's line.
  - New: `lane-tier` refuses a tier the plan's header does not name (or a plan with no `- Tier:` above its first section), and a `schema` tier on a lane without `Schema: yes` or the reverse. `lane-plan-missing` refuses a lane whose plan does not exist. `lanes-stale` refuses a missing, broken or stale generated block.
  - `docs:check` prints `open lanes: disjoint, generated block current (1 open; package 1)`, the tiers counted. `checkUnionJournal` and `scanUnionJournal` are untouched and still run: "union journal: no passage twice".
- The ledger's window section: the entry-shape bullet now describes the lane files, what generates the block and what `docs:check` refuses; the narrative bullet says where history is written. `**Open lanes:**` is replaced by the generated block.
- `/scope` writes the `- Tier:` line and offers opening as **create the lane file**, with the file's shape, `pnpm lanes` and `pnpm docs:check`. `/ship` deletes the lane file and runs `pnpm lanes`. `/bootstrap` deletes the lane files, keeps the block's markers in the fork's window section, and runs `pnpm lanes`. `docs/forking.md` says a fork's lanes are its own lane files. The root `package.json` gains `lanes`.

**The running paragraph: the reading taken, and the amendment.** 0082 §4 said the paragraph "is written by `pnpm lanes` from the files and refused by `docs:check` when stale", and said nothing of the ~42 KB of window history the hand-written paragraph carried. A lane file holds state, not history, so a paragraph generated from the files cannot carry that history, and deleting it would lose the ledger's record of every window since D14. The smallest reading that satisfies both:

- The generated block holds the list and a paragraph of state only.
- The hand-written paragraph is kept **verbatim** in the window section, under `### The running paragraph, frozen at D34.4` below the block, with one sentence saying why it is frozen, and is never edited again. It was checked byte for byte against `HEAD`'s line (42 272 characters).
- From this step on, a window's history is written in the ledger's `How D<n> opened` / `How D<n> closed` sections and in the records' status lines and index rows — where it was already written as well.

0082 §4 is amended in place with that reading, labelled `**Amended 2026-09-30 (D34.4).**`. The amendment also says the list is part of the generated block, so opening or shipping a lane touches its own file alone and a conflict in the block is resolved by running `pnpm lanes`. And it says a lane file names its branch and tier and what `docs:check` refuses about the tier.

**Tests.** `scripts/docs-hygiene.test.mjs`, the lane cases rewritten against lane files (fixtures built in memory, the plan's tier injected through `readPlan`):

- "one open lane reads as before", "two open lanes never share a record", "a second lane on the schema is refused" — the three kept cases, against lane files.
- "a stale running paragraph is refused" — the block as it stood before a second lane's file, a hand edit inside the block, no block, one marker alone.
- "a tier the plan does not name is refused" — a tier the plan contradicts, a plan with no tier in its header, a tier outside the vocabulary, and the `schema` tier without `Schema: yes` and the reverse.
- "the tiers are counted, and the schema tier is at most one lane", "a lane file that does not parse is refused, not skipped" (six malformed files and a misnamed one), "a record not written as a matching link is refused", "a deliverable in progress with no file is refused, and so is a file for one that is not", "a lane whose plan is missing is refused", "a ledger with nothing in progress, no lane files and no block has no lanes".
- "pnpm lanes writes the block, and nothing on a second run" (a temporary root; the frozen history below the block untouched; a file that does not parse writes nothing) and "the generated block survives prettier unchanged".
- The live tree was also probed: with D34's tier edited to `api`, `pnpm docs:check` reported `lane-tier` on `docs/plan/lanes/D34.md:8` and `lanes-stale` on the ledger, and was clean again once the file was restored.

**Done-whens.**

- The three kept cases, "a stale running paragraph is refused" and "a tier the plan does not name is refused": green (`docs-hygiene.test.mjs` 58 of 58).
- `pnpm lanes` twice after the block was first written: `lanes: unchanged docs/plan/README.md (1 open)` both times.
- `pnpm docs:check`: clean.
- `pnpm test:scripts`: green, 125 tests.

**Gate**, over the whole diff, with `TEST_DB_LANE=claude-nifty-planck-bnxu4s` and nothing else exported, never `--force`:

- `pnpm lint`: pass (22 tasks, 2 cached; `test:scripts` 125 tests and `docs:check` inside it).
- `pnpm check-types`: pass (17 tasks, 3 cached).
- `pnpm test`: pass (17 tasks, 0 cached, 8m41s, under the `tiers` lock). `api` 51 unit files / 836 tests and 29 int files / 847 tests; `@repo/db` 7 unit files / 125 tests and 6 int files / 128 tests; `admin` 54 files; `customer` 39 files. All 23 `db:migrate →` lines name `machxi_claude-nifty-planck-bnxu4s_test`.
- `pnpm size`: pass (4 tasks).
- `pnpm format:check`: pass.

**Review.** **Owed.** This builder session has no Agent tool, so it could not run the one bounded review in a fresh context; by ADR-0082 §2 its own reading is not the review, and none is recorded here. The orchestrating session runs it over this step's commit — `adr-reviewer` fits, the step amending 0082 §4 and moving 0079 — and a confirmed finding is fixed in a `D34.4` follow-up commit, noted below.

**Pending the operator.** Nothing is browser-only. CI state was not read (steps 1–4 close on the local gate); the pull request's `gate.yml` run on this push is its CI proof. **Read 0082 §4's `D34.4` amendment**: it is the reading taken of the running paragraph, with the ledger's history frozen in the window section rather than moved or dropped.

**`pnpm step:check` on the committed tree** (`ea1bbee` before this paragraph was added), with `TEST_DB_LANE=claude-nifty-planck-bnxu4s`, base `d518b5938943` (`git merge-base origin/main HEAD`), exit 0:

```
step:check against d518b5938943b56fafbb726ae37fa268a77b4efe
  ran      check
  ran      integration @repo/db (every file: apps/api/test/setup/env.test.ts changed): 6 file(s)
  ran      integration api (every file: apps/api/test/setup/env.test.ts changed): 29 file(s)
  ran      size (admin, customer)
  ran      format:check
step:check ✓
```

`check`: 39 tasks and then `test:unit`'s 17 (all cached), all successful. The base is the lane's merge base, so `D34.1`'s harness change is still a trigger and both integration tiers ran whole: `@repo/db` 128 tests and `api` 847. `size`: 4 tasks cached. After it only this paragraph was written; `pnpm format:check` and `pnpm docs:check` were re-run over it.

### D34.4 — the review, and its findings' fates

**The one review** was run by the orchestrating session: `adr-reviewer` over `bfc52d3`, in a fresh context. It confirmed the history is kept byte for byte (`cmp`, 42 585 bytes against `3f8336c`), the `#the-window` anchor is intact, 0079's status line is right, and every old refusal still fires. It reported five findings. The builder checked each against the code: all five were confirmed, and all five are fixed in the follow-up commit `fix(docs,scripts,adr): D34.4 follow-up — the review's findings`.

1. **[MAJOR] The starter merge brought the starter's open lane files into a fork. Confirmed; fixed both ways.** A lane file is a new file, and a merge takes a file added on one side without consulting a driver. `scripts/merge-attributes.test.mjs` "a starter merge adds the starter's lane file, which the documented step removes" shows it: after the merge with both drivers, the fork's ledger is its own and `docs/plan/lanes/D40.md` is present.
   - **The documented step.** `docs/forking.md` §5's code block gains `git diff --name-only --diff-filter=A ORIG_HEAD -- 'docs/plan/lanes/D*.md' | xargs -r git rm -q`, which removes every lane file the merge added and leaves the fork's own, with a paragraph on why and when to commit it. `/bootstrap` names the same command. The case reads the command from `docs/forking.md`, requires `/bootstrap` to repeat it, runs it, and asserts that only the fork's `D1.md` and `lanes/README.md` remain.
   - **The check.** `docs:check` gains `lane-foreign`: a lane file for a deliverable the ledger has no row for, with the `git rm` instruction. While one exists the block is not compared, so `lanes-stale` does not advise the `pnpm lanes` that would write the starter's lane into the fork's window. Case: "a lane file the ledger has no row for is foreign, and pnpm lanes is not the answer". A file for a row that is not `in progress` is still `lane-not-open`.
2. **[MAJOR] A record link could parse and be ignored. Confirmed; fixed.** Reproduced: `- Records: [0084](…)` followed by an indented `[0079](…)` line parsed as records `[0084]` alone. `parseLaneFile` now refuses any indented line, and any non-blank line after the first field that is not a field; the title and prose above the first field are still not read. Case: "an indented or nested line in a lane file is refused" (a continued record, a nested `- Records:`, a bare link after the fields).
3. **[MAJOR] ADR-0065 §5 was contradicted and not named. Confirmed; fixed.**
   - 0082's Supersedes line gains 0065 §5, amended in place and labelled "**added 2026-09-30 (D34.4)**". The delta: the window section states the window's state alone, and window history is the ledger's `How D<n>` sections plus each record's status line and index row. 0082's head note says 0065 §5 moves at `D34.4`.
   - 0065's status line gains the delta, with a second head note ("Superseded in part again … at `D34.4`"); its body is untouched.
   - The index rows for 0065 and 0082 say so. `pnpm rules:digest` wrote 0 of 3: no digest line states §5's sentence.
4. **[MINOR] Stale claims sat under the window section's authority clause. Confirmed; fixed as the orchestrating session decided.**
   - The frozen paragraph moved out of the window section into its own `## The window's history, frozen at D34.4`, directly after it. It is still verbatim, checked against `3f8336c`, and its intro now says why it sits outside.
   - The authority clause now covers the open lanes as the lane files and the generated block state them, the lane files being right; it says the history after the section states nothing in force.
   - The narrative bullet links the new section. 0082 §4's `D34.4` amendment, 0079's head note and 0082's index row say where the history is.
   - `/bootstrap` drops that section and the bullet's link to it.
5. **[MINOR] Lane-file links were unchecked. Confirmed; fixed.**
   - Reproduced: `[D36](../0035-….md)` parsed. The plan's file must now open with the deliverable's zero-padded number (`D34` → `0034-`); the "does not parse" case gains that fixture.
   - `docs/plan/lanes/README.md` is added: one paragraph on what a lane file is and its shape. `readLaneFiles` skips it, and it keeps the directory and the window section's link when no lane is open. `/bootstrap` keeps it and deletes only `D<n>.md` files.

**Checks after the fix**, with `TEST_DB_LANE=claude-nifty-planck-bnxu4s`, never `--force`. Only documents and scripts changed, so the whole gate was not re-run (the orchestrating session's instruction).

- `pnpm test:scripts`: pass, 128 tests. `docs-hygiene.test.mjs` has 60, `merge-attributes.test.mjs` 7.
- `pnpm docs:check`: clean, including "open lanes: disjoint, generated block current (1 open; package 1)" and "union journal: no passage twice".
- `pnpm lanes` twice: unchanged both times.
- `pnpm rules:digest` twice: 0 of 3 both times.
- `pnpm format:check`: pass.
- `pnpm check`: pass. 39 tasks (5 cached), then `test:unit`'s 17 (cached).

## D34.5 — Every lane a branch and a pull request; every step a commit (2026-09-30)

Built in a cloud session on the lane branch `claude/nifty-planck-bnxu4s` (PostgreSQL 16 on localhost:5432, no Docker, no dev stack, no root `.env`), as one commit pushed there; not merged to `main`. This is the first step that closes the new way: on `pnpm step:check`, with the pull request's `gate.yml` run as its proof.

**The run read first.** The GitHub tools list `gate.yml` runs for the branch (this session has no `gh`). The last push, `20df2ee` (`D34.4`'s follow-up), was run 91, `in_progress` when the step began. Run 90 on `bfc52d3` was `cancelled` by that push, and runs 87–89 on `D34.2`'s and `D34.3`'s commits were `success`. Nothing was red, so the step built without a fix-forward commit.

**Moved at this step.** [ADR-0079](../adr/0079-parallel-lanes.md) → `superseded by` [ADR-0082](../adr/0082-lanes-on-one-machine-and-one-main.md) for §4 and for the alternative §Alternatives declined (lanes that merge to `main` only at ship). [ADR-0059](../adr/0059-ci-containers-and-deployment.md) → `superseded by` 0082 for §1 and §2. Each has its delta on the status line and a head note; the bodies are untouched. The index rows for 0059, 0079 and 0082 and the topic table's CI row say so. The process digest's "Lanes" line is rewritten to the one shape and now cites 0082 first, and its "Verification" line gains the one review in a fresh context and the withdrawn close-out step; `pnpm rules:digest` wrote 1 of 3, then 0 of 3.

**Built.**

- `/step`: one commit pushed to the lane's pull request. It begins by reading the last push's `gate.yml` run — `gh run list --branch <lane branch> --workflow gate.yml` locally, the GitHub tools in a cloud session. Green, it builds; red or unfinished, it fixes forward first in a commit of its own; still running, it builds without waiting; unreadable, it says so in the note and builds. It works on the branch the lane file names and sets `TEST_DB_LANE` from `pnpm db:lane`. It ends on `pnpm step:check`, re-run after a review fix, never `--force`. One review in a fresh context; a builder without a reviewer never reviews its own diff, says the review is owed, and the orchestrating session's pass is the one review, landing as a follow-up commit. It never merges to or pushes to `main`, and merges `main` in only when the plan needs it or GitHub reports a conflict, regenerating a conflicted generated file (`pnpm lanes`, `pnpm rules:digest`).
- `/steps`: the same loop, each step in a subagent whose prompt carries the lane branch and the new rules. It never waits on CI, because each step reads the last run first. It states the pattern for builders without an Agent tool: the orchestrator runs the one review over the pushed commit and dispatches one fix subagent for confirmed findings. It never runs a check itself.
- `/ship`: on the lane's head, never on `main`. It merges `main` in, runs the definition of done with the gate held under one `tiers` lock across its links (`node scripts/with-lock.mjs tiers -- sh -c '<the gate>'`, which `MACHXI_LOCKS_HELD` lets reach the nested locks), then regenerates, syncs the records, removes the lane file and runs `pnpm lanes`, moves the ledger row and writes the changelog. It pushes the ship commit and waits for the pull request's run on it, the one wait in a lane. It merges with a merge commit (`gh pr merge --merge`, or the GitHub tools' `merge` method), never squash or rebase, and tags the merge commit after confirming its second parent is the ship commit. A session that cannot push a tag names the commands for the operator.
- `/scope`: the header names its `scoped in full YYYY-MM-DD` date, which `docs:check` reads. Every step builds, and none is a close-out: residuals, spec, skills and rule files go in the last build step's done-when, and the digests, the definition of done, the merge and the tag go to `/ship`. Opening is the lane file, a documents-only opening commit pushed to `main`, the lane branch cut (or the session's branch named), and the draft pull request by `gh pr create --draft` or the GitHub tools. A session limited to its own branch says so and lets the opening commit ride with the pull request, safe only while no other lane is open — as D34's own opening did (ledger §How D34 opened).
- `scripts/docs-hygiene.mjs`: `checkCloseOut` and `scanCloseOut` refuse a plan step whose title names a close-out, or whose done-when is the definition of done (`close-out-step`, ADR-0082 §2). A plan whose header gives a `scoped` or `shipped` date on or before `CLOSE_OUT_WITHDRAWN` (2026-09-30, 0082's date) is exempt, so D34's own step 6 stays allowed. The date is read from `scoped` and `shipped` alone, because a header's other dates — "from the row inserted 2026-09-14" — say nothing about when the plan was written. `docs:check` prints `close-out steps: none (28 plan(s) exempt by date)`.
- `gate.yml`: comments only. The header says what a pull-request run proves: the whole tree over the merge ref, one run per burst of pushes, read by the next step and required green by `/ship`. The `on:` comment names the commits that still reach `main` directly — `/scope`'s documents-only commits — beside a lane's merge. What the workflow runs is unchanged (`git diff` shows only `#` lines).
- `CLAUDE.md` rule 3: "A lane is a branch and one pull request, a step one commit to it: a step ends green on the step check, a lane on the gate; `main` moves at `/ship`." To stay under the 6 KB cap (6134 bytes), the `test:int` comment loses "against DATABASE_URL_TEST", which a lane rewrites anyway, and the running-stack and subagents paragraphs are shortened without losing a rule.
- `.claude/README.md`: the lanes bullet states the one shape and says the skills use `gh` locally and the GitHub tools in a cloud session. The process bullet says what `/step`, `/steps` and `/ship` now do, and the reviewers' bullet says who runs the one review. The fuller account of lanes on one machine and in the cloud is step 6's, by the plan.
- `docs/README.md`: the conventions paragraph says the open lanes are lane files, stated once in the window section, where it had said all window and date history lives there, which `D34.4` ended. A paragraph states the one shape, and a "Is the lane green?" entry points at the pull request's run.
- Also brought to the one shape: the ledger's "Executing a step", `code-reviewer`'s opening line (the step check has run, not the gate), and `/new-resource-ui`'s closing check (the step check, not the gate).

**Amended against the plan, labelled.** Step 5's done-when said "pushed to `lane/D34`". It now reads "the lane branch its lane file names", labelled `**Amended 2026-09-30 (D34.5).**`, as the Constraints and the definition of done already read: D34 builds on `claude/nifty-planck-bnxu4s`.

**Tests.** `scripts/docs-hygiene.test.mjs`:

- "a plan with a close-out step is refused": a clean plan passes. It refuses a step titled `Close-out.`, one titled "…, and close-out" and one whose done-when is the definition of done, each flagged once with its line. An undated plan is not exempt.
- "a plan scoped or shipped by the day close-outs were withdrawn is exempt by its date": shipped, scoped and shipped-only headers on or before the date are exempt. A header's "row inserted" date is not read, nor a date below the header. D34's own plan is exempt, and with its dates moved a day later its step 6 is the one step refused.
- "this repository's plans carry no close-out step past their date": the live tree.

**Done-whens.**

- "a plan with a close-out step is refused": green (`docs-hygiene.test.mjs` 63 of 63).
- `pnpm docs:check`: clean.
- `pnpm test:scripts`: green, 131 tests.
- This step's commit pushed to the lane branch with the pull request's run green on it: **green**. `b28fc19` was pushed to `claude/nifty-planck-bnxu4s`, and `gate.yml` run **92** on it (pull request #2, run id 36765300439) concluded **`success`** at 19:35:56Z. The GitHub tools read it: lint, check-types, test, size and format:check, each `success`. This is recorded in a notes-only commit after it.

**`pnpm step:check` on the final tree** (everything above written but this paragraph), with `TEST_DB_LANE=claude-nifty-planck-bnxu4s`, base `d518b5938943` (`git merge-base origin/main HEAD`), never `--force`, exit 0:

```
step:check against d518b5938943b56fafbb726ae37fa268a77b4efe
  ran      check
  ran      integration @repo/db (every file: apps/api/test/setup/env.test.ts changed): 6 file(s)
  ran      integration api (every file: apps/api/test/setup/env.test.ts changed): 29 file(s)
  ran      size (admin, customer)
  ran      format:check
step:check ✓
```

`check`: 39 tasks (5 cached), then `test:unit`'s 17 (all cached), all successful; `test:scripts` 131 and `docs:check` inside `lint`. The base is the lane's merge base, so `D34.1`'s harness change is still a trigger and both integration tiers ran whole: `@repo/db` 6 files / 128 tests, `api` 29 files / 847 tests, all 23 `db:migrate →` lines on `machxi_claude-nifty-planck-bnxu4s_test`. `size`: 4 tasks cached. An earlier run over a tree still being edited was stopped by this session partway through its integration tier. That left the `tiers` lock with a dead holder, and this run took it over, printing the holder, as `with-lock` is built to do. After this run, only this paragraph was written; `pnpm format:check` and `pnpm docs:check` were re-run over it.

**Review.** **Owed.** This builder session has no Agent tool, so by ADR-0082 §2 — and the rewritten `/step` — it does not review its own diff, and none is recorded here. The orchestrating session runs the one bounded review over this step's commit, `adr-reviewer` fitting a record- and skill-heavy step, and a confirmed finding lands as a `D34.5` follow-up commit, noted below.

**Pending the operator.**

- **Repository settings: not done by this session, pending.** The step asks for `main` protected with `gate` required, direct pushes kept for `/scope`'s documents-only commits, force pushes blocked. That is the operator's, and this session has no tool that reads or writes it. GitHub's branch protection for a private repository on a personal account needs a paid plan; where it is not available, the rule stays the convention the skills follow, as 0082 §1 says.
- **Read `CLAUDE.md`'s diff**: rule 3 and three trims under the cap.
- Nothing is browser-only.

**CI read after the push.** Run 91 on `20df2ee` (`D34.4`'s follow-up), `in_progress` when this step began, concluded `success`. Run 92 on this step's commit `b28fc19` concluded `success`, the step's proof by the plan. This session read both with the GitHub tools, not `gh`, which it does not have. The notes-only commit that records them triggers a run of its own, which the next step reads first.

### D34.5 — the review, and its findings' fates

**The one review** was run by the orchestrating session: `adr-reviewer` over `b28fc19`, in a fresh context. It found that the four skills agree with [ADR-0082](../adr/0082-lanes-on-one-machine-and-one-main.md) §1–§2 and with each other, that no old-shape text is left, and that the records are clean. It reported five gaps in the skills and the close-out check. The builder checked each one against the skills and the code. All five were confirmed, and all five are fixed in the follow-up commit `fix(claude,scripts): D34.5 follow-up — the review's findings`.

1. **[MAJOR] A conflicted pull request gets no CI run, and neither `/step` nor `/ship` handled it. Confirmed; fixed.**
   - The problem: GitHub builds no merge ref, and so runs no `pull_request` workflow, while a pull request conflicts with `main`. `/step` would have found no run for the head and fallen into "cannot be read — build", and `/ship`'s wait would never end.
   - `/step` gains a case for no run on the lane's last pushed commit. It reads the pull request's `mergeable`/`mergeStateStatus` (`gh pr view --json …`, or the GitHub tools' pull-request read). On `CONFLICTING` it merges `origin/main` in, regenerates the conflicted generated files (`pnpm lanes`, `pnpm rules:digest`), runs `pnpm step:check`, pushes the merge as its own commit, and reads again. Mergeable or `UNKNOWN` is a queued run, treated as still running.
   - `/ship` step 10 gains the same case, since `main` can move after step 1. It also now waits on the lane's last pushed commit, not the ship commit.
   - Step 12 takes the merge commit from the pull request (`gh pr view --json mergeCommit`, or the GitHub tools' read), not from `origin/main`, which may have moved. It confirms that the commit's second parent is the head the run proved green — the ship commit or a fix-forward after it — where it had said "the ship commit", which a fix-forward makes wrong.
2. **[MAJOR] `/scope` in a cloud session left the lane branch without the scoping and opening commits. Confirmed; fixed.**
   - A session's branch is cut before scoping, and only `lane/D<n>` was cut from the opening commit. The session branch is now brought to the opening commit before anything else (`git merge --ff-only origin/main`, or the local `main` holding the commits) and pushed. The first `/step` finds the plan, the lane file and the row.
   - In the limited-session case, both the scoping and the opening commit become the lane branch's first commits and ride with the pull request, as D34's own opening did (ledger §How D34 opened). With another lane open, the session asks the operator to push both to `main`, since the numbers the scoping reserves would otherwise be reserved only on the branch.
   - Step 6's refused-push sentence points at that case.
3. **[MAJOR] A lane on a cloud session's branch cannot be continued or shipped from another cloud session. Confirmed; fixed.**
   - `/step` and `/steps` each gain one sentence: such a lane continues only from a session given that branch, or from a local clone. `/steps` also no longer claims that a re-run anywhere picks up "exactly as if nothing had happened".
   - `/ship` gains the branch check `/step` has, at its top, stopping with the same sentence.
4. **[MINOR] The close-out check could be dodged, and it had a false positive. Confirmed; fixed.**
   - Both were reproduced before the fix. A later plan whose header cited "the day D34 shipped 2026-09-30" read as exempt, and "Shift close-out report" was refused.
   - `planDate` now reads the `- Status:` line alone: its `scoped` date, else the `shipped` date that leads a shipped plan's line. A title is a close-out only when it opens with the word (`^close[- ]?out\b`); the done-when rule catches the checklist under another name.
   - All 28 plans are still exempt by their own dates, D34's step 6 among them.
   - New assertions: "a plan with a close-out step is refused" gains the "Shift close-out report" title, which passes. "…exempt by its date" gains a status line citing another deliverable's ship, which neither dates nor exempts a later plan and whose close-out step is refused, and a date on a header line other than the status line, which is not read.
   - Both tests fail against `b28fc19`'s `docs-hygiene.mjs` and pass against the fix.
5. **[MINOR] `/ship` without `gh` could not merge the draft pull request. Confirmed; fixed.** Step 11 now says to mark it ready with `gh pr ready` or the GitHub tools' pull-request update with `draft: false`, because a draft cannot be merged.

**Checks after the fix**, with `TEST_DB_LANE=claude-nifty-planck-bnxu4s`, never `--force`.

- `node --test scripts/docs-hygiene.test.mjs`: 63 pass.
- `pnpm docs:check`: clean, "close-out steps: none (28 plan(s) exempt by date)".
- A first `pnpm step:check` over the fix went red on `format:check` alone, over this notes file, whose appended section had not been through prettier. It was formatted, and the step check re-run:

```
step:check against d518b5938943b56fafbb726ae37fa268a77b4efe
  ran      check
  ran      integration @repo/db (every file: apps/api/test/setup/env.test.ts changed): 6 file(s)
  ran      integration api (every file: apps/api/test/setup/env.test.ts changed): 29 file(s)
  ran      size (admin, customer)
  ran      format:check
step:check ✓
```

`check`: 39 tasks (5 cached; `test:scripts` and `docs:check` inside `lint`), then `test:unit`'s 17 (cached), all successful. Integration: `@repo/db` 128 tests and `api` 847, all 23 `db:migrate →` lines on `machxi_claude-nifty-planck-bnxu4s_test`. `size`: 4 tasks cached. After it only this paragraph was written; `pnpm format:check` and `pnpm docs:check` were re-run over it.

**CI on the follow-up**, read with the GitHub tools. Run 93, on the notes-only commit `e5f8226`: `success`. Run **94** (run id 36769169840, pull request #2), on the follow-up commit `8209bc4`: **`success`** at 20:06:20Z. This is recorded in a notes-only commit after it, whose own run the next step reads first.

## D34.6 — Close-out — the last one (2026-09-30)

Built in a cloud session on the lane branch `claude/nifty-planck-bnxu4s` (PostgreSQL 16 on localhost:5432, no Docker, no dev stack, no root `.env`), as one commit pushed there; nothing merged to or from `main`. The last close-out step any plan carries: D34 was scoped with it before [ADR-0082](../adr/0082-lanes-on-one-machine-and-one-main.md) §2 withdrew them, and `docs:check` exempts it by the plan's date.

**The run read first.** The GitHub tools list `gate.yml` runs for the branch (this session has no `gh`). The last push, `c17e00b` (`D34.5`'s notes-only commit), was run **95** (run id 36770333261), `in_progress` when the step began, so the step built without waiting; read again before the commit, it had concluded **`success`** at 20:17:50Z. Runs 93 and 94, on `e5f8226` and `8209bc4`, were `success`. Nothing was red, so no fix-forward commit. The pull request read `mergeable_state: unstable` (checks running, no conflict), base `d518b59` = `origin/main`, so `main` was not merged in.

**Built.**

- `.claude/README.md` gains a section, "How a lane runs — on one machine, and in the cloud", one bullet each for **the tier** (what the step check runs and which machine a lane can live on; `package` anywhere, `api` a database of its own, `schema` the one lane with migrations; what `docs:check` refuses), **the database** (`export TEST_DB_LANE=$(pnpm --silent db:lane)`; the shared container on one machine, the session's own Postgres and the committed `.env.test` files in the cloud; `main` and CI on `machxi_test`), **the step check** (the same command in both; sized against the merge base with `origin/main`, so fetch first; never `--force`; the shared turbo cache on one machine), **the lock** (the git common directory every worktree shares on one machine, takeover of a dead holder, a timeout that stops with the holder's name and is never cleared by the session; in the cloud the session's own), **the pull request** (the branch the lane file names, one draft pull request, a commit a step, never a force push; `lane/D<n>` in a worktree with `gh` locally, the session's branch with the GitHub tools in the cloud; a lane on a session's branch continues and ships only from a session given that branch or a local clone; where the session cannot push to `main`, `/scope`'s commits ride with the pull request, safe only with no other lane open), and **what neither runs** (the dev stack is the operator's, so the browser tier and the Postman run sit beside the gate for the operator). Citations carry their topic gloss; no step number, date or bare range (`docs:check`: inherited documents clean).
- **The digests regenerated**: `pnpm rules:digest` wrote 0 of 3, and 0 of 3 again. `D34.5` had already rewritten the process digest's Lanes and Verification lines, and this step's diff is in `.claude/` alone, which no rule line reads.
- No record, spec or skill changed; nothing amended against the plan.

**The definition of done**, every item that can run before the merge, with `TEST_DB_LANE=claude-nifty-planck-bnxu4s` exported, never `--force`:

1. **The gate, locally, under the lock: green.** `node scripts/with-lock.mjs tiers -- sh -c 'pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check'`, exit 0, over the tree with `.claude/README.md` final; the plan's tick and this note were written while or after it ran, and the step check below ran over the final tree. `lint` 22 tasks (2 cached; `test:scripts` 131 pass, `docs:check` inside it); `check-types` 17 (3 cached); `test` 17 tasks, 0 cached, 8m51s under the lock, which `MACHXI_LOCKS_HELD` let `pnpm test` and `pnpm size` reach without waiting on their parent — unit and integration together: `api` 836 unit and 847 integration (29 files), `@repo/db` 125 and 128 (6 files), `admin` 335, `customer` 287, `@repo/contracts` 246, `@repo/grid` 209, and every other package green; all 23 `db:migrate →` lines on `localhost:5432/machxi_claude-nifty-planck-bnxu4s_test`; `size` 4 tasks cached, `FULL TURBO`, every budget `ok`; `format:check` "All matched files use Prettier code style!". **By `gate.yml` on the pull request's head: green on `c17e00b`** (run 95), the head when this step began. This step's own commit starts a new run, which this step does not wait on; `/ship` reads it, and requires the run on its own ship commit green in any case.
2. **`pnpm test:unit` twice: green, the second `FULL TURBO`.** Both runs were 17 of 17 cached, `FULL TURBO` (289 ms, then 72 ms): no unit task's inputs changed since the gate's `test` run and `D34.5`'s step check, because this step's diff touches `.claude/README.md` and the plan alone.
3. **`pnpm rules:digest` twice: wrote 0 of 3, then 0 of 3. `pnpm lanes` twice: "unchanged docs/plan/README.md (1 open)", both runs. `pnpm docs:check`: clean** — inherited documents clean, 16 behaviour specs, open lanes disjoint with the generated block current (1 open; package 1), tag prefix `starter`, union journal no passage twice, close-out steps none (28 plans exempt by date). **`pnpm test:scripts`: 131 pass, 0 fail.**
4. **Every step a commit on the lane branch, none merged to `main`: true.** `git log origin/main..HEAD` lists every step's commit and follow-up — `6d70e01`/`fb67bed` (`D34.1`), `12adf33` (`D34.2`), `87714e6`/`3f8336c` (`D34.3`), `bfc52d3`/`20df2ee` (`D34.4`), `b28fc19`/`e5f8226`/`8209bc4`/`c17e00b` (`D34.5`), and the opening and scoping commits under them — and `git branch -r --contains` names `origin/claude/nifty-planck-bnxu4s` alone for each, never `origin/main`. This step's commit is the same once pushed. **Owed to `/ship`, not runnable here:** the pull request merged with a merge commit, and `gate.yml` green on `main` after it.
5. **A clean tree: true** after this step's commit (`git status --short` empty before the step's edits; the step's files are all in the commit). `/ship` checks it again after its own.

**The step check**, `pnpm step:check`, over the final tree (everything above written but its output below):

With `TEST_DB_LANE=claude-nifty-planck-bnxu4s`, base `d518b5938943` (`git merge-base origin/main HEAD`), never `--force`, exit 0:

```
step:check against d518b5938943b56fafbb726ae37fa268a77b4efe
  ran      check
  ran      integration @repo/db (every file: apps/api/test/setup/env.test.ts changed): 6 file(s)
  ran      integration api (every file: apps/api/test/setup/env.test.ts changed): 29 file(s)
  ran      size (admin, customer)
  ran      format:check
step:check ✓
```

`check`: 39 tasks (5 cached), then `test:unit`'s 17 (all cached), all successful. Integration: `@repo/db` 128 tests and `api` 847, on the lane database. `size`: 4 tasks cached. The base is the lane's merge base, so `D34.1`'s harness change is still a trigger and both integration tiers ran whole. After it only this paragraph was written; `pnpm format:check` and `pnpm docs:check` were re-run over it.

**Review.** **Owed.** This builder session has no Agent tool, so by ADR-0082 §2 it does not review its own diff, and none is recorded here. The orchestrating session runs the one bounded review over this step's commit — `adr-reviewer` or `code-reviewer`, the diff being documents only — and a confirmed finding lands as a `D34.6` follow-up commit, noted below.

**Pending the operator — every item gathered from `D34.1`–`D34.6`, in one place for `/ship` and the operator.**

1. **Branch protection on `main`** (from `D34.5`): not done, and no tool in these sessions reads or writes it. Where the GitHub plan allows it, `main` protected with `gate` required, direct pushes kept for `/scope`'s documents-only commits, force pushes blocked; where it does not (a private repository on a personal account), the rule stays the convention the skills follow, as 0082 §1 says. Say which.
2. **Read `CLAUDE.md`'s diff** (from `D34.2` and `D34.5`): §Commands names the step check beside the gate; rule 3 reads "A lane is a branch and one pull request, a step one commit to it: a step ends green on the step check, a lane on the gate; `main` moves at `/ship`"; and the trims that keep it under the 6 KB cap (the `test:int` comment, the running-stack and subagents paragraphs).
3. **Read 0082 §4's `D34.3` amendment — the starter-merge command has two flags**: `git -c merge.ours.driver=true -c merge.union.driver=true merge starter/main`, where the plan named one, because a command-line driver runs only for a path whose attribute names it and the changelog's `union` would otherwise let the starter's entries into a fork; `docs/plan/** merge=ours` stays, inert in a lane merge; 0081 §5 joined the lane to say so.
4. **Read 0082 §4's `D34.4` amendment — the running paragraph**: it is generated from the lane files and states only what they say, and the ledger's hand-written window history is frozen verbatim in its own section after the window section, never edited again.
5. **The browser tier and the Postman run** were not run in this lane: no dev stack in these sessions, and D34 touches no endpoint and no SPA geometry. Nothing is browser-only.
6. **Draft PR #2's body is stale** (its step list unticked, its "Pending the operator" still asking for a PostgreSQL): `/ship` marks the pull request ready and may refresh the body to this list.

**Nothing blocks `/ship` from this step**, beyond the run on this commit (and on the ship commit) and the review owed above.

### D34.6 — the review, and its findings' fates

**The one review** was run by the orchestrating session: `adr-reviewer` over `ab4d934`, in a fresh context. It found nothing that blocks `/ship`, one major wording fix for a `D34.6` follow-up commit, and three minors the orchestrating session folds into the ship commit.

1. **[MAJOR] The tier bullet in `.claude/README.md` said the tier decides what the step check runs, and that a `package` lane "runs anywhere". Confirmed; fixed** in `fix(claude,adr): D34.6 follow-up — the review's findings`. `scripts/step-check.mjs` never reads the tier; it sizes itself from the diff, and D34, a `package` lane, ran both integration tiers and `size` on Postgres at every step since `D34.2`. The bullet now says the tier declares what the lane expects to need (`package`: no Postgres beyond a harness's own tests, no SPA build, `/scope`'s wording), that the step check still sizes itself to the diff, and that a lane touching a test harness or a package with an integration tier needs Postgres whatever its tier; "runs anywhere" is gone. [ADR-0082](../adr/0082-lanes-on-one-machine-and-one-main.md) §5's "The tier names what the step check runs and which machine the lane can live on" is struck and amended in place, labelled `**Amended 2026-09-30 (D34.6).**`. The process digest's "Lane files and tiers" line said the same as §5's loose sentence, so its source in `scripts/rules-digest.mjs` takes `/scope`'s wording and the same clause; `pnpm rules:digest` wrote 1 of 3, then 0 of 3.
2. **[MINOR] The ledger row's stale phrases.** Folded into the ship commit by the orchestrating session.
3. **[MINOR] The index row's Implemented cell.** Folded into the ship commit by the orchestrating session.
4. **[MINOR] The PostgreSQL pending item** (PR #2's body). Folded into the ship commit by the orchestrating session.
5. **No action**: the plan was built as written.

**Checks after the fix**: `pnpm docs:check` clean, `pnpm format:check` clean, `pnpm rules:digest` 1 of 3 then 0 of 3, `pnpm test:scripts` green. The step check was not re-run for a wording fix in documents and a digest line, on the orchestrating session's instruction.
