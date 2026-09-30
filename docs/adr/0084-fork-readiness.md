# ADR-0084: Fork readiness — a scripted bootstrap, a rehearsed starter merge, and the commit behind the metrics token (supersedes ADR-0082, 0065 and 0081 in part — deltas)

- Status: accepted
- Date: 2026-09-30
- Supersedes (at the step that makes each delta true): [ADR-0065](0065-starter-lifecycle.md) §3 and §5 (delta: a fork's journal is reset by a script, `pnpm bootstrap`, which the `/bootstrap` skill calls, and a rehearsal in the test suite proves the reset and the starter merge; `/scope` on a ledger with no rows writes the first row the operator names); [ADR-0082](0082-lanes-on-one-machine-and-one-main.md) §4 (delta: after the starter merge, every journal file the merge added under `docs/plan/` is removed, not only lane files, and a journal file the fork deleted that the starter changed is resolved by deleting it; the merge-down of `docs/upstreaming.md` uses the same commands); [ADR-0081](0081-build-versions.md) §3 (delta: `/health` answers `commit` only to a caller presenting the metrics token). Every parent stands for everything not named here.

> Written 2026-09-30 by `/scope` for D36 ([`docs/plan/0036-fork-readiness.md`](../plan/0036-fork-readiness.md)), the day D34 shipped, on the operator's decisions from the fork-readiness review — writing is not opening, opening is not accepting. `proposed` at writing; **accepted 2026-09-30 at the head of `D36.1`**, where [ADR-0065](0065-starter-lifecycle.md) moved to `superseded by` for §3 and §5; [ADR-0082](0082-lanes-on-one-machine-and-one-main.md) moved at `D36.2` and [ADR-0081](0081-build-versions.md) at `D36.3`, the steps that make each delta true. Amendable in place, labelled, while D36 is `in progress` ([the ledger](../plan/README.md#the-window)).

## Context

D34 was the last starter deliverable before the fork. A review of the starter the day it shipped found the records sound and the fork procedure unproven. A dry run of `/bootstrap` and a starter merge in a throwaway clone showed:

- `/bootstrap` is a list of edits an agent performs by hand, so nothing tested it, and its acceptance check asked `/scope` to scope a first row that the reset had just removed.
- The documented starter merge stops on a modify/delete conflict whenever the starter changes a plan the fork deleted, which is every ship. The lane-file removal after it then fails on the files the conflicted merge staged. Plans and notes files the starter adds arrive and take numbers from the fork's own sequence.
- `docs/upstreaming.md`'s merge-down is a plain `git merge`, which conflicts on the ledger and silently unions the starter's changelog into the fork's.
- The gate is red in every fork, because two script tests read the starter's journal and one hard-codes the product name's length, and the rename leaves files Prettier would re-wrap.
- `/health` answers the full commit to anyone, which maps a public instance to its exact source (a residual logged at `D32.1` and never routed).

Each of these is small. Together they mean the first fork would find them one at a time, in its own repository, and fix each one downstream.

## Decision

Deltas on the parents named above. Everything else each decides stands, and is in force as part of this record.

### 1. The journal reset is a script, and a rehearsal proves the fork

`pnpm bootstrap --prefix <name>` (`scripts/bootstrap.mjs`) performs the reset ADR-0065 §3 describes. It removes the starter's plans, notes and lane files and keeps `docs/plan/lanes/README.md`. It writes the empty ledger with the fork's `Tag prefix:`, the window section's generated block, and no link to the starter's frozen history. It resets the changelog to its preamble under the fork's prefix. It refuses a tree that is not a fresh clone of the starter. The `/bootstrap` skill runs it and keeps what needs judgement: the rename, the licence and the remote.

`scripts/fork-rehearsal.test.mjs` runs on every push, uncached, in the gate's `test` link (amended below). It clones the tree into a temporary directory, bootstraps and renames it, and runs the fork's `docs:check` and script tests. It then simulates a starter ship, an opening and a plan edit, and runs the starter-merge commands exactly as `docs/forking.md` states them. It asserts that the fork's journal is kept and that the fork's checks pass afterwards. A change that breaks the fork breaks the starter's gate.

**Amended 2026-09-30 (D36.2, the review): where the rehearsal runs.** It reads the whole tree — `apps/` and `packages/` as well as the root — and `//#test:scripts` is a cached root task whose hash covers the root package's files only, so inside it a change under `apps/` replayed a green the rehearsal never re-ran (ADR-0026, a cached result is a proof only when its inputs are the task's). So it is its own root task, `//#test:fork` (`pnpm test:fork`), with `cache: false`, and the `test` task depends on it: the gate's `test` link runs it, with no change to the gate's command line, and `test:scripts` leaves it out. `pnpm step:check` runs it after `pnpm check` unless every changed path is a document under `docs/` other than `docs/forking.md` and `docs/upstreaming.md`, the two it reads its commands from.

On a ledger with no rows, `/scope` writes the first row with the number and title the operator names, instead of asking for a `planned` row to exist.

**Amended 2026-09-30 (D36.5).** `pnpm docs:check` refuses a relative link to a missing file in every Markdown file a fork carries — everything outside `docs/plan/`, plus the ledger and `docs/plan/lanes/README.md` — so a document that links into a starter plan fails the rehearsal's fork. A link into `docs/plan/` from a record, the ADR index or a review is history, read at `starter/main`, and is exempt; a broken link in a frozen record is allowed by name with its reason, and refused as stale once it works.

### 2. The starter merge removes every journal file it brings

After `git -c merge.ours.driver=true -c merge.union.driver=true merge starter/main`, every file the merge added under `docs/plan/` is removed with `git rm -qf`: plans, notes files and lane files. That leaves the fork's own journal, which was there before the merge. A modify/delete conflict under `docs/plan/` is resolved by deleting the file.

**Amended 2026-09-30 (D36.2, the review): the list compares two commits.** The files removed are those `starter/main` has and `ORIG_HEAD` lacks under `docs/plan/` — `git diff --name-only --no-renames --diff-filter=A ORIG_HEAD starter/main -- docs/plan | xargs -r git rm -qf --ignore-unmatch` — never `ORIG_HEAD` against the working tree, which listed the fork's staged journal files when the merge refused to start over them, and removed them. `--no-renames` keeps a near-identical file from pairing as a rename. A conflict on a journal file the fork already had, which it changed and the starter deleted or moved, keeps the fork's side. `docs/upstreaming.md`'s merge-down runs the same commands. The drivers and the attributes of 0082 §4 are unchanged.

### 3. The commit is answered to the operator, not the public

`/health` answers `version` to every caller. It answers `commit` only when the request carries the metrics token and a token is configured, the same credential `/metrics` reads. The contract gains no field, and an unauthenticated caller simply sees none.

## Consequences

- The fork procedure is proved by a test on every push, not by a one-off dry run.
- A starter merge in a fork is three commands, and the fork's gate is green after them.
- A public `/health` no longer names the source revision. The operator reads it with the metrics token.
- What a fork still inherits knowingly is listed in D36's plan under §Not in D36. Tags a cloud session cannot push, branch protection and the Renovate app are the operator's.

## Alternatives considered

- **Fixing the documents and dry-running again.** It would pass once. The next change to the journal's shape would break it silently, as D34's changes did.
- **Keeping the starter's plans in a fork**, so the links in carried records resolve. It would put the starter's journal and numbering beside the fork's, which ADR-0065 §3 decided against. The records keep their links as history, read at `starter/main`.
- **A short commit on `/health`.** On a public repository a short commit maps to the source as well as a long one.
