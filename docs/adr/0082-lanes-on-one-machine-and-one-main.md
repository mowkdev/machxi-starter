# ADR-0082: Lanes on one machine and one `main` — every lane a branch and a pull request, a step checked for what it reaches, the whole tree gated by CI on every push and locally once at ship, a test database per lane (supersedes ADR-0079, 0059, 0026, 0021, 0007, 0004 and 0065 in part — deltas)

- Status: proposed
- Date: 2026-09-30
- Supersedes (at the step that makes each delta true): [ADR-0079](0079-parallel-lanes.md) §2, §4 and §Alternatives (delta: every lane is a branch and one pull request from its first step; a step is a commit pushed to it, and the lane reaches `main` once, when `/ship` merges the pull request; the open lanes are files the window section links); [ADR-0059](0059-ci-containers-and-deployment.md) §1 and §2 (delta: the gate workflow on a pull request is the whole-tree proof of every step, and `main` takes a lane's opening commit and its pull request's merge, nothing else); [ADR-0026](0026-task-graph-caching-and-serialisation.md) §The fast loop (delta: a step's local check is the fast loop plus the integration files its change reaches, never forced cold; the whole tree gates in CI on every push and locally once, at ship; the tiers that contend for a shared resource on one machine run under a lock); [ADR-0021](0021-testing-strategy.md) and [ADR-0007](0007-local-development-docker.md) (delta: the integration tier's database is one of a family, `machxi_<lane>_test`, derived from the branch); [ADR-0004](0004-configuration-and-environment.md) (delta: `packages/db/.env.test` joins the file layout, committed, so the db package's tier reads no untracked file); [ADR-0065](0065-starter-lifecycle.md) §3 (delta: `merge=ours` applies to the starter merge alone, never as a standing attribute a lane merge would hit). Every parent stands for everything not named here.

> Written 2026-09-30 by `/scope` for D34 ([`docs/plan/0034-lanes-on-one-machine.md`](../plan/0034-lanes-on-one-machine.md)), with D29 and D32 in progress, on the operator's review of the first two-lane day — writing is not opening, opening is not accepting. `proposed`; accepted at the head of `D34.1`. **Revised 2026-09-30 while `proposed`**, on the operator's decision, before D34 opened. As scoped, §1 landed each step through GitHub's merge queue, which is not offered for a private repository on a personal account, which this one is; a first revision the same day replaced the queue with a local landing script that re-gated only what `main`'s new commits met. The operator then asked for the loop itself to be shortened rather than the landing, on the day's record (§Context): a step's critical path was mostly verification that proved nothing new. This revision is the answer: a lane is one pull request, a step is a commit checked locally for what it reaches and proved whole by CI, and the whole tree is gated locally once, at ship.

## Context

ADR-0079 let two deliverables run at once when their records are disjoint, and the first day under it (D29 beside D31, then D32) proved the half it decided: the records stayed apart, and the only document conflicts were the ledger's running paragraph and one index row (§How D31 closed). What it did not decide was the machine, and the machine is where the day was lost:

- Both lanes' integration tiers rebuilt the same `machxi_test` at once — 91 cases deadlocked (`D29.1` notes). Each lane then got a database of its own by editing the tracked `apps/api/.env.test` under `skip-worktree`, an edit three notes files call "residual, for the operator to route".
- Each step of each lane ran the whole gate, cold, in its own worktree: two `tsc -b` sweeps, two Vite builds, two 800-case tiers on one laptop. Timing-sensitive tests flaked a different pair each run; the gate was run at `--concurrency=2` "to ease memory" (`D31.2`).
- Docker Desktop's port forward timed out under that load four times in a day, once on a lane running alone; the same commits gated green first time on a Linux runner (`D29.3`). `gate.yml` already runs the identical gate on every push to `main` and every pull request, and nothing waits for it.
- `main` moved under a step's gate twice, and every merge conflicted on the window paragraph (`D31.2`). Each move meant merging `main` again and re-running the whole gate, as ADR-0079 §4 required, so `D31.1` gated three times over one diff. The faster lane's every landing restarted the slower lane's gate, and a slower lane whose gate outlasts the faster lane's steps never closes.
- `D29.3` went green on its fourth whole-tree run; the three before it each failed a different pair of timing-sensitive concurrency cases. A flake cost three gates, not one file.
- Every step pushed `main` twice — the build and a documents-only commit for the review — and each push ran CI for 11 to 25 minutes; every deliverable ended in a documents-only close-out step that ran the whole gate; and where a builder had no reviewer agent, its own pass and the orchestrator's independent pass were both taken. Steps forced cold runs (`pnpm test --force`, `D31.1`), paying for work the cache had already proved.

Measured across the day, a step closed every thirty to forty-five minutes and the build was the smaller part of it. Roughly half of the gate runs proved nothing that an earlier run had not.
- `packages/db`'s integration tier reads the untracked root `.env` while the API's reads the tracked `apps/api/.env.test`, so a cloud session, which cannot read `.env`, lost a gate run to `DATABASE_URL_TEST_OWNER is not set` (`D32.1`).
- `.gitattributes` carries `docs/plan/** merge=ours`, and `/bootstrap` defines the driver in a fork's clone. Attributes apply to every merge, so in a fork the first lane merge would keep its own ledger and silently drop the other lane's. The starter has not seen it only because the driver is not configured here.

What the sessions did instead — checking each other before every suite run — is the most expensive coordination there is, and it produced stale work. The fix is not coordination. It is isolation where a lane needs it, a check the size of the change on the builder's critical path, and the whole tree proved where it is cheap — by CI on every push, off that path — and locally once, when the lane ships.

## Decision

Deltas on the parents named above. Everything else each of them decides stands and is in force as part of this record.

### 1. Every lane is a branch and one pull request; a step is a commit; `main` moves once per lane

A lane builds on a branch of its own from its first step, whether or not another lane is open; the allowance in ADR-0079 §4 for a lone lane to build on `main` is withdrawn, so `/step` has one shape. The branch is `lane/D<n>` cut from `main` at opening, or the branch a cloud session was given, and the lane's file (§4) names it. Opening the lane also opens **one draft pull request** from that branch, whose body carries the plan's link; the pull request is the lane's record on GitHub for as long as it runs.

**A step is one commit pushed to the lane branch.** It ends with §2's check green, one bounded review (ADR-0050 §Verification 2, unchanged), the plan ticked, the note appended, the push. It does not merge `main` in, does not merge to `main`, and does not wait for CI. `gate.yml` runs the whole gate on every push to the pull request, over the head merged into `main` as GitHub builds it, so each push is proved against the current tree without the lane merging anything; a burst of pushes costs one run, the last, under the workflow's existing cancellation. **The next step begins by reading the last push's run.** Green: it builds. Red, or failed to finish: it fixes forward first, in its own commit, before it builds; and a session that cannot read CI state says so in the step's note and builds, because the ship below cannot pass without a green head. Unverified work is thereby bounded to one step. `main` is merged into the lane only when the lane needs something `main` has, or when GitHub reports a conflict; a conflict only in generated files is regenerated, never hand-merged.

**`/ship` runs on the lane's head**, not on `main`: `main` merged in, the definition of done executed (the whole gate locally, once, under §2's lock), the ship commit pushed, the pull request's gate green on that head, and then the pull request merged with a merge commit, so the per-step commits the ledger cites survive on `main`; the tag goes on the merge commit. **`main` takes exactly two writes per lane**: the opening commit, documents only, which `/scope` pushes so that the window section and the lane file are on `main` for every other lane's `docs:check`; and the merge. Nobody pushes anything else to `main`, and ADR-0059 §2's allowance for direct pushes narrows to the opening commit. Where the repository's plan lets `main` be protected, it is, with `gate` required and the merge commit the only path; where it does not, the same two writes are the convention `/scope` and `/ship` follow and `docs:check` reads.

`/steps`' rule of one retry then stop applies unchanged. A lane that needs a step of another lane waits for that lane to ship, as ADR-0079 §1 already requires of their records. ADR-0079 §Alternatives declined lanes that merge to `main` only at ship for the size of the merge; the size was the ledger's, and §4 removes it.

### 2. The step's check is the size of the change; the whole tree gates by CI, and locally once

`CLAUDE.md` §Commands defines two commands, each once. **The step check**, what a step runs before it pushes: `pnpm check` — the cached fast loop, lint carrying the script tests and the document checks, types, unit — and then **the integration files the change reaches**: `vitest run --changed <base>` on each affected package's integration config, where `<base>` is the lane's merge base with `main`, so only the files that import a changed module run; `size` only when an SPA or a platform package is in `--filter="...[<base>]"`; `format:check` over the tree. **The gate** (unchanged in content): the whole tree, by `gate.yml` on every push to the pull request, and on the machine only for `/ship`'s definition of done. ADR-0026's rule that a contended task runs at `--concurrency=1` is kept and extended: on one machine the tiers that contend across lanes — `test:int`, `size`, `test:e2e` — run under a repository-level lock (`scripts/with-lock.mjs`), so a second lane waits and prints who holds it rather than colliding or asking. A cloud session is its own machine and holds its own lock.

Nothing re-runs what is proved. `main` moving is never a reason to run anything again; the pull request's next run covers it. A fix after the review re-runs the step check over the packages the fix reaches. A cached result is a proof: `/step` never passes `--force`, because ADR-0026's purity rule is what makes a hit correct, and a task a builder suspects of impurity is a defect in its `inputs` or `env`, fixed there rather than run cold. **A red run re-runs the failed files, not the gate**: a file that fails in the run and passes alone, twice, is logged by name in the step's note as a flake owed a hardening step, and the step goes on; a file that fails alone is the step's defect. The timing-sensitive concurrency cases the day's notes name are that hardening step's, in the deliverable that owns them.

**One review per step**, in a fresh context, on the diff — ADR-0050 §Verification 2 as written. Where the builder cannot run a reviewer, the orchestrating session's pass is the one review, not a second; the builder's own reading is not a review. **A deliverable has no close-out step**: what the close-out did — the routed residuals, the spec, the skills and rule files, the digests — is the last build step's or `/ship`'s, and `/scope` writes no step whose diff is documents only.

A worktree may point `TURBO_CACHE_DIR` at one cache beside the checkouts; ADR-0026's purity rule is what makes a hit from another lane's run correct.

### 3. A test database per lane, derived and never edited

The integration tier's database is `machxi_<lane>_test`, where `<lane>` is the slug of the current branch (`lane/D29` → `d29`, `spike/d29-rls` → `spike-d29-rls`), and `machxi_test` when the branch is `main` or `TEST_DB_LANE` is unset. The harness — `apps/api/test/setup/env.ts` and `@repo/db/testing` — rewrites the database name of `DATABASE_URL_TEST` and `DATABASE_URL_TEST_OWNER` after the env files load; the `_test` suffix guard stays underneath. `/step` sets `TEST_DB_LANE` from the branch; `pnpm db:lane` takes no argument and creates the current branch's database with `machxi_test`'s owner and grants, idempotently. `TEST_DB_LANE` is declared in `turbo.json` for `test` and `test:int`, per ADR-0026. `packages/db/.env.test` is committed beside the API's, the same shape, so neither tier reads an untracked file and a cloud session gates from a clone.

### 4. Shared surfaces that do not conflict

Each open lane is a file, `docs/plan/lanes/D<n>.md`, in the shape ADR-0079 §2 gave the entry; the ledger's window section lists them by link, and `pnpm docs:check` reads the files. The running paragraph under the list is written by `pnpm lanes` from the files and refused by `docs:check` when stale, the way the digests are. `docs/plan/*.notes.md` and `docs/CHANGELOG.md` merge by `union`: one writer each, appends only. The `docs/plan/** merge=ours` attribute is removed; the starter merge applies the driver on the command line (`git -c merge.ours.driver=true merge starter/main`), which is what `/bootstrap` and `docs/forking.md` say.

### 5. Tiers of lane

A plan's header carries `- Tier: package | api | schema` beside `- Schema:`. `schema` lanes are at most one (ADR-0079 §3, unchanged); `api` lanes each take a database under §3; `package` lanes need no Postgres and no build, and any number may be open. The tier names which gate `/step` runs and which machine the lane can live on. `docs:check` reads it from the lane file.

### 6. What this record declines

- **Parallel steps inside one lane**, and **a record shared by agreement** — ADR-0079 §6 stands.
- **A merge queue** — GitHub's, or a hosted one. GitHub offers its queue for a public repository an organization owns, or a private one on Enterprise Cloud; this repository is private on a personal account. A hosted queue is a paid third party a fork would inherit. With one merge per lane the queue has nothing to order.
- **A landing script that re-gates where `main`'s new commits meet the step** (this record's first revision). Correct, and unnecessary once a step no longer lands on `main`: the pull request's run over the merged head is the same proof, made by CI.
- **A step that only pushes and lets CI decide.** The local check is the builder's loop and CI the confirmation; a step whose first signal is fifteen minutes away, on a tree two commits further on, costs more to unwind than the check it saved.
- **Fatter steps.** A step is bounded by what one builder holds in context and one reviewer reads in a diff, not by the cost of closing it; this record cuts the cost and leaves the bound.
- **A required human approval on `main`.** It would stop an unattended `/ship` from ever merging; the bounded review stays where it is, before each commit.
- **The browser tier in either gate.** ADR-0052 and ADR-0059 §1 stand.
- **A Postgres container per lane.** One container, one database per lane, is enough; what failed was the port forward under two whole-tree gates, and §2 removes those.

## Consequences

- A step's critical path is the build, the step check and one review. It never waits on CI, on `main`, or on another lane; a faster lane's steps no longer restart a slower lane's gate, because neither touches `main` until it ships.
- Every push is still proved whole, by CI over the head merged into `main`; a red run is found one step later at most and fixed forward. A lane sees another lane's changes when it merges `main` in or at ship, and their records being disjoint is what keeps that merge small.
- A cloud session and a local worktree run the same shape: a branch, a pull request, the step check, the lane's own database; only the lock is per machine. A session that cannot read CI state says so and is caught at ship.
- The whole gate runs on the machine once per lane, at ship, under the lock. Two whole-tree gates never run beside each other on one machine.
- A lane's database is created once by `pnpm db:lane` and never named by hand; a spike worktree gets one the same way.
- Opening a lane touches one file under `docs/plan/lanes/` and one link line and is the one documents-only push to `main`; notes and the changelog never conflict.
- The starter merge in a fork is one explicit command; a lane merge in a fork behaves like any merge.
- `.claude/settings.json` allows what §1 runs unattended: `git push`, `git merge`, `git worktree`, `gh pr *`, `gh run *`; a cloud session uses the GitHub tools it has for the same two reads and two writes.
- A fork inherits all of this with the records, and its first lane opens alone on `lane/S1`.

## Alternatives considered

- **Keeping the local gate as the proof and adding coordination between sessions.** Measured on the first day: agents watching each other, stale work, and four port-forward timeouts. Coordination is the cost this record removes.
- **The machine as the authority, the whole tree gated locally before each step.** It keeps the whole-tree gate on the laptop that overloaded, and re-runs it whenever `main` moves — the loop this record removes.
- **A step merged to `main` as it lands** (ADR-0079 §4). Keeps `main` the tree every session reads, at the price measured in §Context: a merge, a conflict and a re-gate per step per lane. With records disjoint and the shared surfaces fixed by §4, what the per-step merge bought is gone.
- **The merge queue as first scoped, and a landing script as first revised.** §6.
- **A lane per Postgres container.** Isolates nothing the database name does not, and doubles what Docker Desktop forwards.
- **Union merge on the ledger and the records.** Would produce prose that reads wrong without a conflict to say so; union is for files with one writer and appends only.
- **Keeping `merge=ours` and documenting the risk.** A silent data loss with a paragraph beside it is still a silent data loss.
