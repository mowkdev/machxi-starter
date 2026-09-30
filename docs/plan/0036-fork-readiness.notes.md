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
