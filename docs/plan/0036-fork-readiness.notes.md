# D36 — Fork readiness: build notes

The per-step build record of [D36](0036-fork-readiness.md) — what was built, the amendments, the review findings and their fates, the step check's output, and what is pending the operator — kept apart from the executable plan so a builder opens the plan and not the journal ([ADR-0068](../adr/0068-behaviour-specs-and-plan-notes.md) §2, the plan apart from its notes). `/step` appends here; `/ship` reads it.

## D36.1 — Accept ADR-0084; the journal reset as a script; the script tests fork-safe (2026-09-30)

Built in a cloud session on the lane branch `claude/nifty-planck-bnxu4s` (PostgreSQL 16 on localhost:5432, no Docker, no dev stack, no root `.env`), committed and pushed there; not merged to `main`.

**The run read first.** `gate.yml` run 36778178321 on `d50ae228`, the lane's last pushed commit (the opening commit), was `in_progress` when read, so this step was built without waiting on it. The run before it, 36773274925 on D34's ship commit `8ff5f9d1`, was `success`.

**Accepted at the head.** [ADR-0084](../adr/0084-fork-readiness.md) is `accepted`, and its header note says which parent moves at which step. [ADR-0065](../adr/0065-starter-lifecycle.md) moved to `superseded by` 0084 for §3 and §5: the delta is on its status line, with a head note, and its body is untouched. The index rows for 0065 and 0084, the topic table's forking row and the index's "starter as a starter" note name 0084. The process digest gains "The bootstrap and the rehearsal" (0084, 0065), the accepted record's own line. `pnpm rules:digest` wrote 1 of 3 digests, then 0 of 3. [ADR-0082](../adr/0082-lanes-on-one-machine-and-one-main.md) moves at `D36.2` and [ADR-0081](../adr/0081-build-versions.md) at `D36.3`.

**Built.**

- `scripts/bootstrap.mjs` (`pnpm bootstrap --prefix <name>`, root manifest). It checks everything before writing anything, and refuses:
  - a prefix the ledger's `Tag prefix:` grammar would not parse, or `starter`;
  - a directory that is not the top of a git work tree;
  - a dirty tree;
  - a ledger whose prefix is not `starter`;
  - a journal missing a part it rewrites.

  It then removes every file under `docs/plan/` except the ledger and `lanes/README.md`. It writes the ledger from the starter's own: the header under the fork's prefix, the table's header row with no rows, the `## Rules` and `## The window` sections, and the block `renderLanes([])` writes. Every sentence that links a dropped section or one of the removed plans is dropped, so the two frozen-history links go. It resets the changelog to its preamble, with the two phrases about the starter's own entries rewritten. If either phrase is not found exactly once, it refuses rather than guess. It commits nothing.

- `scripts/rename.mjs`:
  - The walk is now `renameTree({ root, name, dryRun })`. It is exported and runs only as a command, so a test can drive it on a fixture.
  - Each rewritten `.ts`, `.tsx`, `.mjs`, `.md`, `.json` or `.css` file is formatted through Prettier with the configuration and `.prettierignore` that `format:check` uses.
  - Formatting repeats until the text is stable, three passes at most. One pass is not a fixed point. In the rehearsal below, `backfill-personal-organizations.int.test.ts`'s lengthened member chain was broken on the first pass and joined on the second, and `format:check` failed on it until the passes repeated.
  - The placeholder `TOKEN` is exported, so the test never spells it and a fork's rename cannot rewrite it.
- `scripts/docs-hygiene.test.mjs`:
  - The D34-plan case reads `D34_PLAN`, a fixture in D34's shape: dated on the withdrawal day, five build steps and a close-out.
  - "this repository's plans carry no close-out step past their date" asserts that the exemption count equals the number of plans dated on or before the withdrawal. The plan's wording is amended in place, labelled (below).
- `scripts/db-lane.test.mjs`: the length case asserts `bytes(base) + 1 + MAX_SLUG_LENGTH` over a named `product` base, rather than `+ 12`.

**Amended against the plan (labelled in the plan).** Step 1's "its exemption count asserts only when plans exist" would still fail in a fork once it had scoped its first plan. That plan is dated after the withdrawal, so it is never exempt, and the count would be 0 while plans exist. The case asserts the count of plans dated on or before the withdrawal instead.

**Tests.**

- `scripts/bootstrap.test.mjs` builds starter-shaped clones under the OS temp directory. Each has a ledger with rows, a lane, a frozen-history section and plan links, plus plans, notes, a lane file and a changelog with entries. Git reads no global config.
  - The six done-when cases: "a fresh clone bootstraps to an empty ledger under the given prefix" (the fork's `scanLanes`, `scanTagPrefix`, `scanUnionJournal` and `scanCloseOut` clean, and both rewritten files pass Prettier's check), "the starter's plans, notes and lane files are removed and lanes/README.md is kept", "the ledger carries no link to the frozen history" (every in-page link resolves, no plan link), "the changelog is its preamble under the fork's prefix", "the generated block reads no lane open", and "a tree that is not a fresh starter clone is refused". The last covers eleven refusals, each leaving `docs/` byte-identical.
  - Two command-line cases.
  - The file reads nothing of this repository's journal.
- `scripts/rename.test.mjs`:
  - "the renamed files pass format:check" covers a Markdown table, a wrapped array and the two-pass member chain. Each file's bare rewrite is asserted to fail the check first, and a `.prettierignore`d file is rewritten but not formatted.
  - "a dry run writes and formats nothing".

**A fork, rehearsed by hand.** The rehearsal test itself is `D36.2`'s. A fresh `git clone` of this tree with the step's changes committed ran `pnpm bootstrap --prefix starter` (refused) and then `pnpm bootstrap --prefix acme`, which removed 45 files. After committing, `node scripts/rename.mjs acme-platform` rewrote 1147 occurrences across 205 files, renamed 1 and formatted 46. Then:

- `node scripts/docs-hygiene.mjs`: clean, `tag prefix: acme`, 0 open lanes, 0 plans exempt.
- `pnpm test:scripts`: 141 pass, 0 fail.
- `pnpm format:check`: clean.

The throwaway clones were under the session's scratchpad and are deleted.

**Residual — fixed in the follow-up (finding 1 below).** `db:lane` capped a slug at 40 characters (`MAX_SLUG_LENGTH`), which assumes a short product name. A product name longer than 17 characters puts a 40-character slug past the 63 bytes Postgres keeps. `db:lane` then refuses such a branch, loudly, and the derived length case fails with it. `rename.mjs` allows names up to 32 characters. A fix derives the cap from the base database's length, in `db-lane.mjs` and the harness's `laneDatabaseUrl`. That is outside this step and is offered to the operator as a follow-up.

**Step check.** `export TEST_DB_LANE=$(pnpm --silent db:lane)` printed "already there". Then `pnpm step:check`, never `--force`:

```
step:check against 6b5dc792ccfddcee8e14826f0be14932b52fcf57
  ran      check
  ran      format:check
  skipped  integration: no package with a test:int is reached
  skipped  size: no SPA is reached
step:check ✓
```

- `check`: 39 tasks (5 cached), then `test:unit`'s 17 (all cached), all successful.
- `test:scripts`: 141 pass.
- `docs:check`: clean; `tag prefix: starter`; 29 plans exempt by date.
- After it only the plan's tick and amendment and this note were written; `pnpm format:check`, `pnpm docs:check`, `rules-digest --check` and `pnpm lanes` (unchanged) were re-run over them, all clean.

**Review.** **Owed.** This builder ran as a subagent with no Agent tool, so it could not run the one bounded review in a fresh context. The step is record-heavy and adds a script, so `adr-reviewer` or `code-reviewer` fits. By ADR-0082 §2 the builder's own reading is not a review, and none is recorded here. The orchestrating session runs the review over this step's commit. Confirmed findings land as `fix(scripts): D36.1 follow-up — the review's findings`, with their fates in this file.

**Pending the operator.**

- Nothing is browser-only.
- ~~The `db:lane` residual above waits on a decision.~~ Fixed in the follow-up; see the review below.
- `/bootstrap` still describes the reset as hand edits until `D36.5` rewrites it to run `pnpm bootstrap`.

### D36.1 — the review, and its findings' fates

The orchestrating session ran the one review: `code-reviewer` over `9ae2af52`, in a fresh context. On today's ledger `bootstrap` was correct. The reviewer ran it at `9ae2af52` and got a clean `docs:check` and Prettier, with only the two frozen-history links dropped. The findings are what fails silently once the starter's ledger changes, and one breaks a fork's gate. Each was verified against the code and all five are confirmed. The fixes are in `fix(scripts,db): D36.1 follow-up — the review's findings`.

**The run read first.** `gate.yml` run 36780055856 on `9ae2af52` was `in_progress` when read. Run 36778178321 on `d50ae228` concluded `success`.

1. **The length case fails in a fork whose product name has 18–32 characters (confirms the residual above). Fixed.** A lane name is the base's bytes, an underscore and the slug. With a fixed 40-character cap it fits 63 bytes only for a name of 17 characters or fewer, and the rename allows 32. The operator's decision: derive the cap from the base.
   - `scripts/db-lane.mjs`: `slugCap(testDatabase)` is `63 − bytes(base) − 1`, and refuses a base that leaves no room for a hashed slug. `slugBranch(branch, cap)` truncates to it and keeps the sha1 suffix. `main` reads the base before slugging.
   - `MAX_SLUG_LENGTH` is gone. For `machxi_test` the cap is 51, so this branch's slug and database are unchanged.
   - The harness (`packages/db/src/tooling/test-database.ts`) already agreed: it checks only the slug's shape and the 63-byte total, so it accepts every slug `db:lane` derives. Its comment now says so.
   - `scripts/db-lane.test.mjs`:
     - every case asserts against `slugCap(BASE)`;
     - the truncation cases are cap-relative;
     - new cases: "is what the base and the joining underscore leave of 63 bytes", "a product name of 32 characters still gets a lane database for an ordinary branch" and "refuses a base that leaves no room for a hashed slug".
   - `packages/db/src/__tests__/testing.test.ts`:
     - "refuses a name longer than Postgres keeps" derives its length. It had hard-coded 52, which fits under a shorter fork name.
     - New: "accepts every slug db:lane derives, shorter or longer than forty", covering 1, 40 and the cap, and a 32-character product at its cap and one past it.
2. **Unknown ledger sections were dropped silently. Fixed.** `resetLedger` now refuses, instead of dropping:
   - a `## ` heading that is neither kept (`Rules`, `The window`) nor journal. Journal is `JOURNAL_SECTION`, `/^## (How D\d|The window's history\b|Executing a step$)/`, read against every heading the ledger has today;
   - a kept heading that appears twice;
   - any non-blank line between the table and the first section.

   Case: "a ledger section bootstrap does not know is refused, not dropped", covering a `## Numbering` section, a note under the table and a second `## Rules`.

3. **The sentence split could delete a bold rule. Fixed.** `SENTENCE_BREAK` now splits after `.`, `?` or `!` when closed by `**`, `)`, `_` or a backtick. A sentence to be dropped that contains `**` is refused, not dropped. Case: "a bold rule before a dropped link is kept". `- **A rule, bold.** Then a note on [D8](0008-first.md).` keeps the rule, and a link inside the bold sentence itself is refused.
   - Found while fixing this: the generated block's lane entries were read as prose before the block was replaced. That was harmless before, but the new bold refusal would have fired on the real ledger's own `- **Lane [D36](…)**` entry. The block is now replaced first.
4. **A dropped paragraph left a double blank line. Fixed.** Runs of blank lines collapse to one after filtering. Case: "a paragraph dropped whole leaves the ledger as Prettier writes it". The fixture's window section gains a paragraph that is dropped whole, and the result passes `prettier.check` with no `\n\n\n`.
5. **(Minor) `rename.mjs` stopped after three Prettier passes silently. Fixed.** When the third pass still changed the text, the file is written as the passes left it and a warning naming it goes to stderr. No test was added: no input is known that Prettier leaves unstable after three passes.

The real ledger resets byte-identically to the output before these fixes.

**Step check** over the follow-up, `TEST_DB_LANE=claude-nifty-planck-bnxu4s`, never `--force`:

```
step:check against 6b5dc792ccfddcee8e14826f0be14932b52fcf57
  ran      check
  ran      integration @repo/db (every file: package.json changed): 6 file(s)
  ran      integration api (every file: package.json changed): 29 file(s)
  ran      format:check
  skipped  size: no SPA is reached
step:check ✓
```

- `check`: 39 tasks (4 cached), then `test:unit`'s 17 (15 cached), all successful.
- `test:scripts`: 147 pass.
- Integration: `@repo/db` 6 files / 128 tests and `api` 29 files / 847 tests. Every `db:migrate →` line is on `machxi_claude-nifty-planck-bnxu4s_test`.
- The trigger is the root `package.json` (the `bootstrap` script), which the lane's diff carries from `D36.1`.
- After the check, only this note was written; `pnpm format:check` and `pnpm docs:check` were re-run over it.

## D36.2 — The fork rehearsed; the starter merge removes every journal file it brings (2026-09-30)

**Resumed after an interruption.** A first builder of this step was stopped by a container restart before it checked, reviewed or committed anything. Its uncommitted work was in the tree: eleven modified files and the untracked `scripts/fork-rehearsal.test.mjs`. This builder read all of it against the plan's step 2 and ADR-0084 §1–§2 and kept everything except one file:

- **Reverted:** `.gitattributes`. The first builder had added the removal command to its header comment. Step 2 does not name the file, no test reads the comment, and the plan's constraints keep the attributes of 0082 §4 unchanged. The one statement of the commands is `docs/forking.md` §5, where the rehearsal reads them.
- **Kept, although step 2 does not name it:** `docs/rules/api-and-data.md`. It is generated. With 0082 now `superseded by` 0084, `pnpm rules:digest` cites 0082 as "as carried by ADR-0084" in every rule that names it, in this digest as well as the process one. A re-run wrote 0 of 3 digests.
- **Kept:** `docs/forking.md`, `docs/upstreaming.md`, `.claude/skills/bootstrap/SKILL.md`, `scripts/rules-digest.mjs` (the forking rule's text and its records), `scripts/merge-attributes.test.mjs`, ADR-0082's status line and head note, the ADR index rows for 0082 and 0084, and the new rehearsal test. Each was re-run or re-read here, not taken on trust.

**The run read first.** `gate.yml` run 36781475822 on `d2f7d29a`, the lane's last pushed commit (D36.1's follow-up), concluded `success`. The one before it, 36780055856 on `9ae2af52`, was cancelled by that push.

**Superseded at this step.** [ADR-0082](../adr/0082-lanes-on-one-machine-and-one-main.md) moved to `superseded by` 0084 for §4's starter merge alone. The delta is on its status line, with a head note, and its body is untouched. The index row for 0082 carries the delta, and 0084's row gains its D36.2 entry. The topic table's forking row already named 0084. The forking rule in `scripts/rules-digest.mjs` now also cites 0084 and states the cleanup command.

**Built.**

- `docs/forking.md` §5:
  - the command after the merge is `git diff --name-only --diff-filter=A ORIG_HEAD -- docs/plan | xargs -r git rm -qf`;
  - the prose explains why: a file the starter added, or one the fork deleted that comes back as a modify/delete conflict, is absent from `ORIG_HEAD`, and `-f` is needed because a stopped merge has staged what it added;
  - then commit, with `--no-edit` when the merge stopped;
  - the `git log` line takes `starter-D<n>` rather than a fixed `starter-D13`;
  - the table row for `docs/plan/` says what the merge brings is removed.
- `docs/upstreaming.md` step 6 runs `git fetch starter --tags` and the same two commands, and says why a plain `git merge` is wrong.
- `/bootstrap` names the same command, which `merge-attributes.test.mjs` asserts.
- `scripts/fork-rehearsal.test.mjs` does ADR-0084 §1's rehearsal:
  1. The tree as it stands (tracked and untracked, never ignored) is copied under `os.tmpdir()` and committed there as the starter.
  2. The fork clones it and renames `origin` to `starter`. It runs `node scripts/bootstrap.mjs --prefix acme` and `node scripts/rename.mjs acme-fulfilment-platform` (24 characters, past the old slug cap), committing each.
  3. Side by side, the fork runs `docs:check`, its own script tests, and Prettier's check over every file bootstrap and rename wrote. It then opens its first lane and runs `lanes.mjs` and `docs:check` again.
  4. The starter ships. It edits the newest plan that has notes, and those notes. It opens D99 with a plan, notes and a lane file, adds a ledger row and a changelog entry, and adds a file outside the journal.
  5. The fork runs every line of `docs/forking.md` §5's block that has no placeholder, read from the document, and commits the merge.
  - Git runs with `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`. Nothing is installed: the fork links this tree's root and workspace `node_modules` read-only. In a fork's own tree the ledger's prefix is not `starter`, so the suite skips. That is also why the fork's copy, run in stage 3, does not rehearse again.
  - The suite takes 25–31 s: 30.7 s alone and 25.3 s inside `test:scripts`. `real 0m31.0s` for the file on its own.
- `merge-attributes.test.mjs` reads the new command from `docs/forking.md`. Its new case, "a conflicted starter merge's added lane file is removed by git rm -qf", stops a merge on a modify/delete conflict and shows that `git rm -q` refuses the staged files. It then shows that the documented `-qf` leaves no unmerged path and only the fork's ledger and lanes README, with the removal inside the merge's commit.

**Tests.** `fork-rehearsal.test.mjs`: the six cases the plan names, 6/6. `merge-attributes.test.mjs`: 8/8, including the new case. `test:scripts`: 154 pass, 0 fail. After the rehearsal, `git status` in this repository showed only this step's own changes.

**Residual, for the review.** `//#test:scripts` is a root task, and its default inputs hash the root package's files only. The rehearsal also reads `apps/` and `packages/`, because rename rewrites them and Prettier checks them. So a local cached `test:scripts` can replay a green over a change confined to a workspace that would break the fork's `format:check`. CI runs with no cache and catches it. Widening the task's `inputs` is left to the review or a later step rather than made here unasked.

**Step check.** `export TEST_DB_LANE=$(pnpm --silent db:lane)` printed "already there". Then `pnpm step:check`, never `--force`, in 4 m 9 s:

```
step:check against 6b5dc792ccfddcee8e14826f0be14932b52fcf57
  ran      check
  ran      integration @repo/db (every file: package.json changed): 6 file(s)
  ran      integration api (every file: package.json changed): 29 file(s)
  ran      format:check
  skipped  size: no SPA is reached
step:check ✓
```

- `check`: 39 tasks (5 cached), then `test:unit`'s 17 (17 cached), all successful.
- Integration: `@repo/db` 128 tests and `api` 29 files / 847 tests. Every `db:migrate →` line is on `machxi_claude-nifty-planck-bnxu4s_test`.
- After the check, only this note was written. `pnpm format:check` and `pnpm docs:check` were re-run over it.

**Review.** **Owed.** This builder ran as a subagent with no Agent tool. By ADR-0082 §2 its own reading is not a review, and none is recorded here. The step is record-heavy and adds a test script, so `adr-reviewer` or `code-reviewer` fits. The orchestrating session runs the one review over this step's commit. Confirmed findings land as `fix(scripts,docs): D36.2 follow-up — the review's findings`, with their fates in this file.

**Pending the operator.** Nothing new from this step. D36.1's items stand.

### D36.2 — the review, and its findings' fates

The orchestrating session ran the one review: `code-reviewer` over `3dfcf28d`, in a fresh context. It ran on its third attempt: the first two were lost to container restarts before they reported. Four findings, each confirmed; the fixes are in `fix(scripts,docs): D36.2 follow-up — the review's findings`.

1. **Stale greens from the cache (ADR-0026; confirms the residual above). Fixed.** `//#test:scripts` has no `inputs`, so it hashes the root package's files only, and `gate.yml` restores `.turbo/cache`, so CI replayed it too. The rehearsal now runs outside it:
   - `package.json`: `test:scripts` globs `scripts/**/!(fork-rehearsal).test.mjs`; `test:fork` is `node --test scripts/fork-rehearsal.test.mjs`.
   - `turbo.json`: `//#test:fork` with `cache: false`, and the `test` task depends on it. `pnpm test` runs it once, under the `tiers` lock, so the gate carries it with its command line unchanged.
   - `scripts/step-check.mjs`: after `size` and before `format:check`, `pnpm test:fork` runs unless every changed path is a document under `docs/` other than `docs/forking.md` and `docs/upstreaming.md` (`rehearsalTrigger`). Three new cases in `step-check.test.mjs`.
   - `scripts/docs-hygiene.test.mjs`: "the first link carries every check that can go red" accepts a root check the `test` task depends on with `cache: false` of its own, and reddens when the rehearsal's task is cached.
   - ADR-0084 §1 amended in place, labelled; `README.md`, `docs/forking.md`, the plan's tier line and definition of done, and the process digest's source now say where it runs.
2. **The cleanup deleted the fork's staged work when the merge refused to start. Fixed.** The command is now `git diff --name-only --no-renames --diff-filter=A ORIG_HEAD starter/main -- docs/plan | xargs -r git rm -qf --ignore-unmatch` in `docs/forking.md` §5, `docs/upstreaming.md` step 6, `/bootstrap` and the process digest; ADR-0084 §2 amended in place, labelled. `merge-attributes.test.mjs` reads it, and its two cases give their repository a `refs/remotes/starter/main`. The rehearsal now stages the fork's first lane, lets the starter ship, and runs the documented commands over it: new case "a fork's staged plan survives a merge that refuses to start". With the old command restored in `docs/forking.md` it is red ("docs/plan/0001-first-feature.md was unstaged by the command after the merge").
3. **A `UD` conflict inside `docs/plan` was left unresolved. Fixed** in prose: §5 says a conflict on a journal file the fork already had keeps the fork's, `git checkout --ours -- <path> && git add <path>`; ADR-0084 §2's amendment says the same.
4. **`gitEnv` inherited `GIT_DIR`, `GIT_INDEX_FILE`, `GIT_WORK_TREE`, `GIT_CONFIG_PARAMETERS` and `GIT_CONFIG_COUNT`. Fixed:** the rehearsal drops every inherited `GIT_*` key before setting its own.

**Tests.** `pnpm test:fork`: 7/7 in 16 s. `pnpm test:scripts`: 151 pass, 0 fail, the rehearsal no longer among them. `merge-attributes.test.mjs` 8/8, `step-check.test.mjs` 16/16. `pnpm rules:digest` wrote 1 of 3, then 0 of 3. `pnpm docs:check` clean.

**Step check.** `export TEST_DB_LANE=$(pnpm --silent db:lane)` printed "already there". Then `pnpm step:check`, never `--force`, in 2 m 49 s:

```
step:check against 6b5dc792ccfddcee8e14826f0be14932b52fcf57
  ran      check
  ran      integration @repo/db (every file: package.json changed): 6 file(s)
  ran      integration api (every file: package.json changed): 29 file(s)
  ran      size (admin, customer)
  ran      test:fork (.claude/skills/bootstrap/SKILL.md changed)
  ran      format:check
step:check ✓
```

`size` ran because `turbo.json` is in the diff, which puts both SPAs in the affected filter. After the check, only this note was written; `pnpm format:check` and `pnpm docs:check` were re-run over it.

### D36.3 — the commit behind the metrics token

**The run read first.** `gate.yml` run 36786939909 on the lane's last pushed commit, `a0fe934e` (D36.2's follow-up): **in progress** when read, so the step was built without waiting (`/step` §1). The run before it, 36784620219 on `3dfcf28d`, was green.

**Built.**

- `apps/api/src/core/metrics/metrics.token.ts`: `carriesMetricsToken(req, token)`. It is the bearer read and the constant-time comparison that `metrics.routes.ts` held, moved and not rewritten, so `/metrics` and `/health` share one check. It answers `false` when no token is configured. `/metrics` keeps its own "none configured means open" branch ahead of it, unchanged in behaviour.
- `health.service.ts`: `live` and `ready` take a `HealthDisclosure`, `{ commit: boolean }`, defaulting to the public view, `{ commit: false }`. `commit` is added only when the disclosure asks for it and the image has one. The 503 path carries no commit, as before.
- `health.controller.ts` takes `{ metricsToken }` from `wire.ts` (`config.metrics.token`) and asks `carriesMetricsToken` per request. A missing or wrong token is not an error: the caller gets `version` alone, the same status, and no hint (ADR-0013).
- **No token configured: `commit` is never answered.** ADR-0084 §3 says "only when … a token is configured", and "carries the configured token" cannot be true when none is configured. Outside production, where `METRICS_TOKEN` may be unset, `/health` names no commit to anyone. Production requires the token, so the operator always has a way to read it. The case "with no metrics token configured, no request is answered the commit" proves it.
- ADR-0081's status line gains the §3 delta and a head note. It moved to `superseded by` ADR-0084 at this step. The index row and the Health topic row say so. ADR-0084's head note says 0082 and 0081 "moved".
- `docs/specs/health-and-metrics.md`: a new requirement, "The commit is answered to the operator, not the public", with four scenarios naming the tests. The labelled-build scenario now carries the token. `docs/forking.md`, `docs/deploy.md`, `.env.example`, the contract's `commit` comment and the digest source (`scripts/rules-digest.mjs`, Build versions) say the same. `pnpm rules:digest` wrote 3 of 3: the text changed, and the carried-by chains now include 0084.
- Postman (`/postman-sync`): the Health folder shows both calls. `Health (human view)` has no token and asserts no `commit`. The new `Health (with the metrics token)` sends `Authorization: Bearer {{metricsToken}}`. It asserts no `commit` when no token is configured, and a non-empty one when a token is configured and the image has a commit. `local.postman_environment.json` gains `metricsToken`, empty and secret. `scripts/postman.mjs` passes `METRICS_TOKEN` from `.env`. The Postman README gives the counts, now 213 requests, and the variable.

**Tests.** `apps/api/test/health.int.test.ts`: "an unauthenticated /health answers the version and no commit", "a /health carrying the metrics token answers the commit" and "a wrong token answers no commit and no error". Each of the first two runs over `/health`, `/health/ready` and `/health/live`. The wrong-token case tries another token, the token plus one character, the token minus one, `Basic <token>` and a bare `Bearer`. There is also "with no metrics token configured, no request is answered the commit", and "answers dev and no commit field for a build nobody labelled", which now presents the token. `health.service.test.ts` adds "answers no commit unless the caller is shown it (ADR-0084 §3)". `observability.int.test.ts` still covers `/metrics`'s token after the move.

**Amendments.** None to a record's body. ADR-0081 moved by supersession, as the plan scheduled.

**Step check.**

`export TEST_DB_LANE=$(pnpm --silent db:lane)` printed "already there". Then `pnpm step:check`, never `--force`:

```
step:check against 6b5dc792ccfddcee8e14826f0be14932b52fcf57
  ran      check
  ran      integration @repo/db (every file: package.json changed): 6 file(s)
  ran      integration api (every file: package.json changed): 29 file(s)
  ran      size (admin, customer)
  ran      test:fork (.claude/skills/bootstrap/SKILL.md changed)
  ran      format:check
step:check ✓
```

The comparison base is the lane's merge base with `main`, so the lane's earlier steps widen what the check reaches: `size` and `test:fork` ran for them. After the check, only this note and the plan's tick were written. `pnpm format:check` and `pnpm docs:check` were re-run over them.

**Review.** **Owed.** This builder ran as a subagent with no Agent tool, so by ADR-0082 §2 its own reading is not a review. The change touches an unauthenticated endpoint and a credential check, so `security-reviewer` fits. The orchestrating session runs the one review over this step's commit. Confirmed findings land as `fix(api,docs): D36.3 follow-up — the review's findings`.

**Pending the operator.** `pnpm test:postman` against the operator's running stack, for the two health calls. It is already named in the plan's definition of done, item 5. Run it with and without `METRICS_TOKEN` in `.env`: set, the API must be restarted to read it, and that restart is the operator's.
