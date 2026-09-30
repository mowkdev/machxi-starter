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

**Residual, not fixed here.** `db:lane` caps a slug at 40 characters (`MAX_SLUG_LENGTH`), which assumes a short product name. A product name longer than 17 characters puts a 40-character slug past the 63 bytes Postgres keeps. `db:lane` then refuses such a branch, loudly, and the derived length case fails with it. `rename.mjs` allows names up to 32 characters. A fix derives the cap from the base database's length, in `db-lane.mjs` and the harness's `laneDatabaseUrl`. That is outside this step and is offered to the operator as a follow-up.

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
- The `db:lane` residual above waits on a decision.
- `/bootstrap` still describes the reset as hand edits until `D36.5` rewrites it to run `pnpm bootstrap`.
