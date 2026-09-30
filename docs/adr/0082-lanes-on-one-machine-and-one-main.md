# ADR-0082: Lanes on one machine and one `main` — every lane a branch, a step re-gated only where `main` meets it, the gate proportional to the diff, a test database per lane (supersedes ADR-0079, 0059, 0026, 0021, 0007, 0004 and 0065 in part — deltas)

- Status: proposed
- Date: 2026-09-30
- Supersedes (at the step that makes each delta true): [ADR-0079](0079-parallel-lanes.md) §2 and §4 (delta: every lane is a branch from its first step, a step lands on `main` only through `pnpm land`, which re-gates only what the commits `main` gained since the step's gate meet, and the open lanes are files the window section links); [ADR-0059](0059-ci-containers-and-deployment.md) §2 (delta: a push to `main` is made by `pnpm land` and not by hand, and while `gate.yml` is red on `main` only the land that fixes it is taken); [ADR-0026](0026-task-graph-caching-and-serialisation.md) §The fast loop (delta: a step gates the packages its diff reaches, and a cached result is never forced; the whole tree gates once, on `main`; the tiers that contend for a shared resource on one machine run under a lock); [ADR-0021](0021-testing-strategy.md) and [ADR-0007](0007-local-development-docker.md) (delta: the integration tier's database is one of a family, `machxi_<lane>_test`, derived from the branch); [ADR-0004](0004-configuration-and-environment.md) (delta: `packages/db/.env.test` joins the file layout, committed, so the db package's tier reads no untracked file); [ADR-0065](0065-starter-lifecycle.md) §3 (delta: `merge=ours` applies to the starter merge alone, never as a standing attribute a lane merge would hit). Every parent stands for everything not named here.

> Written 2026-09-30 by `/scope` for D34 ([`docs/plan/0034-lanes-on-one-machine.md`](../plan/0034-lanes-on-one-machine.md)), with D29 and D32 in progress, on the operator's review of the first two-lane day — writing is not opening, opening is not accepting. `proposed`; accepted at the head of `D34.1`. **Revised 2026-09-30 while `proposed`**, on the operator's decision, before D34 opened: GitHub's merge queue is not offered for a private repository on a personal account, which this one is, so §1 lands a step with `pnpm land` instead, re-gating only where the commits `main` gained meet the step; §2 gains the rule that a cached result is never forced and that a review fix re-gates only what it reaches; §6 declines the merge queue by name.

## Context

ADR-0079 let two deliverables run at once when their records are disjoint, and the first day under it (D29 beside D31, then D32) proved the half it decided: the records stayed apart, and the only document conflicts were the ledger's running paragraph and one index row (§How D31 closed). What it did not decide was the machine, and the machine is where the day was lost:

- Both lanes' integration tiers rebuilt the same `machxi_test` at once — 91 cases deadlocked (`D29.1` notes). Each lane then got a database of its own by editing the tracked `apps/api/.env.test` under `skip-worktree`, an edit three notes files call "residual, for the operator to route".
- Each step of each lane ran the whole gate, cold, in its own worktree: two `tsc -b` sweeps, two Vite builds, two 800-case tiers on one laptop. Timing-sensitive tests flaked a different pair each run; the gate was run at `--concurrency=2` "to ease memory" (`D31.2`).
- Docker Desktop's port forward timed out under that load four times in a day, once on a lane running alone; the same commits gated green first time on a Linux runner (`D29.3`). `gate.yml` already runs the identical gate on every push to `main` and every pull request, and nothing waits for it.
- `main` moved under a step's gate twice, and every merge conflicted on the window paragraph (`D31.2`). Each move meant merging `main` again and re-running the whole gate, as ADR-0079 §4 required, so `D31.1` gated three times over one diff. The faster lane's every landing restarted the slower lane's gate, and a slower lane whose gate outlasts the faster lane's steps never closes.
- Steps forced cold runs (`pnpm test --force`, `D31.1`), paying for work the cache had already proved.
- `packages/db`'s integration tier reads the untracked root `.env` while the API's reads the tracked `apps/api/.env.test`, so a cloud session, which cannot read `.env`, lost a gate run to `DATABASE_URL_TEST_OWNER is not set` (`D32.1`).
- `.gitattributes` carries `docs/plan/** merge=ours`, and `/bootstrap` defines the driver in a fork's clone. Attributes apply to every merge, so in a fork the first lane merge would keep its own ledger and silently drop the other lane's. The starter has not seen it only because the driver is not configured here.

What the sessions did instead — checking each other before every suite run — is the most expensive coordination there is, and it produced stale work. The fix is not coordination. It is isolation where a lane needs it, a gate the size of the diff, a landing that re-proves only what another lane's commits could have changed, and one place where the whole tree is proved.

## Decision

Deltas on the parents named above. Everything else each of them decides stands and is in force as part of this record.

### 1. Every lane is a branch; a step lands by `pnpm land`, re-gated only where `main` meets it

A lane builds on `lane/D<n>` from its first step, whether or not another lane is open; the allowance in ADR-0079 §4 for a lone lane to build on `main` is withdrawn, so `/step` has one shape. A step merges `main` in and runs the lane gate of §2 once, over the merged tree. It then closes by `pnpm land` (`scripts/land.mjs`), which does, under the `land` lock of §2:

1. **Fetch `origin/main`.** Call the commit the step's gate merged in `G` and the fetched tip `M`.
2. **Refuse a red `main`.** When the latest completed `gate.yml` run on `main` failed, only a land that names that run as what it fixes (`pnpm land --fixes <run>`) is taken; a revert is the operator's call. A session that cannot read CI state says so in the land's output and in the step's notes, and lands.
3. **Nothing new** (`G` is `M`): no gate runs.
4. **Something new**: merge `M` into the lane. A conflict only in generated files — the digests, the running paragraph — is regenerated; any other conflict stops the land, and the step resolves it and runs its lane gate again, because the conflict is new work. The land then takes **the meet**: the packages the commits `G..M` reach, dependents included, intersected with the packages the step reaches. An empty meet runs nothing. A non-empty meet runs the lane gate's links over the meet alone. A change at the root — the lockfile, `turbo.json`, a root config — reaches every package, so its meet is the step's whole set; that is the one case a land re-runs everything the step gated.
5. **One commit onto `M`**, the merged tree with `M` its only parent, titled with the step's conventional message, pushed to `main`. A push `main` rejects — another session landed outside this machine's lock — goes back to 1 with `G` set to the `M` just proved, so each round costs only what the newer commits meet.

**A step is closed when `main` carries it.** `gate.yml` runs the whole tree on every push to `main` and is the proof of the tree after the fact; step 2 is what makes a red `main` stop every lane rather than be built on. Nobody pushes to `main` by hand, and nobody merges a step to `main` any other way. One commit per step on `main`, whose body carries the review findings and their fates.

The next step of a lane does not wait for CI: it starts on the lane branch and merges `main` in before its own gate, which is where a step that turned `main` red is found. `/steps`' rule of one retry then stop applies unchanged. `/ship` runs on `main` as fetched from `origin`, and lands its own commit the same way.

### 2. The gate is proportional to the diff; the whole tree gates once

`CLAUDE.md` §Commands defines two commands, each once. **The lane gate**, what a step runs once before it lands: the gate's links over `--filter="...[main]"` — every package whose files differ from `main` and everything that depends on one — with `size` only when an SPA or a platform package is in that set, and `format:check` over the tree. **The gate** (unchanged): the whole tree, on `main`, by `gate.yml`, and on the operator's machine only for `/ship`'s definition of done. ADR-0026's rule that a contended task runs at `--concurrency=1` is kept and extended: on one machine the tiers that contend across lanes — `test:int`, `size`, `test:e2e` — run under a repository-level lock (`scripts/with-lock.mjs`), so a second lane waits and prints who holds it rather than colliding or asking; §1's `land` is a lock of the same kind.

Nothing re-runs what has already been proved. `main` moving is §1's to answer and never a reason to run the lane gate again. A fix after the review re-runs the lane gate's links over the packages the fix reaches. A cached result is a proof: `/step` never passes `--force`, because ADR-0026's purity rule is what makes a hit correct, and a task a builder suspects of impurity is a defect in its `inputs` or `env`, fixed there rather than run cold.

A worktree may point `TURBO_CACHE_DIR` at one cache beside the checkouts; ADR-0026's purity rule is what makes a hit from another lane's run correct.

### 3. A test database per lane, derived and never edited

The integration tier's database is `machxi_<lane>_test`, where `<lane>` is the slug of the current branch (`lane/D29` → `d29`, `spike/d29-rls` → `spike-d29-rls`), and `machxi_test` when the branch is `main` or `TEST_DB_LANE` is unset. The harness — `apps/api/test/setup/env.ts` and `@repo/db/testing` — rewrites the database name of `DATABASE_URL_TEST` and `DATABASE_URL_TEST_OWNER` after the env files load; the `_test` suffix guard stays underneath. `/step` sets `TEST_DB_LANE` from the branch; `pnpm db:lane` takes no argument and creates the current branch's database with `machxi_test`'s owner and grants, idempotently. `TEST_DB_LANE` is declared in `turbo.json` for `test` and `test:int`, per ADR-0026. `packages/db/.env.test` is committed beside the API's, the same shape, so neither tier reads an untracked file and a cloud session gates from a clone.

### 4. Shared surfaces that do not conflict

Each open lane is a file, `docs/plan/lanes/D<n>.md`, in the shape ADR-0079 §2 gave the entry; the ledger's window section lists them by link, and `pnpm docs:check` reads the files. The running paragraph under the list is written by `pnpm lanes` from the files and refused by `docs:check` when stale, the way the digests are. `docs/plan/*.notes.md` and `docs/CHANGELOG.md` merge by `union`: one writer each, appends only. The `docs/plan/** merge=ours` attribute is removed; the starter merge applies the driver on the command line (`git -c merge.ours.driver=true merge starter/main`), which is what `/bootstrap` and `docs/forking.md` say.

### 5. Tiers of lane

A plan's header carries `- Tier: package | api | schema` beside `- Schema:`. `schema` lanes are at most one (ADR-0079 §3, unchanged); `api` lanes each take a database under §3; `package` lanes need no Postgres and no build, and any number may be open. The tier names which gate `/step` runs and which machine the lane can live on. `docs:check` reads it from the lane file.

### 6. What this record declines

- **Parallel steps inside one lane**, and **a record shared by agreement** — ADR-0079 §6 stands.
- **A merge queue** — GitHub's, or a hosted one. GitHub offers its queue for a public repository an organization owns, or a private one on Enterprise Cloud; this repository is private on a personal account. A hosted queue is a paid third party a fork would inherit. §1's land gives what the queue would, a `main` no step reaches unproven where it changed, at the cost of the whole-tree proof coming after the push rather than before. A repository that gains a queue supersedes §1.
- **A required human approval on `main`.** It would stop an unattended step from ever landing; the bounded review stays where it is, before the commit.
- **The browser tier in either gate.** ADR-0052 and ADR-0059 §1 stand.
- **A Postgres container per lane.** One container, one database per lane, is enough; what failed was the port forward under two whole-tree gates, and §2 removes those.

## Consequences

- A step's close waits on the `land` lock and on whatever the commits `main` gained meet — usually nothing, since lanes' records are disjoint and their packages mostly are. It never waits on CI, and a faster lane's landing no longer restarts a slower lane's gate.
- `main` can be red between a push and its `gate.yml` run, when two lanes' changes meet in a way neither's packages showed. The land's refusal of a red `main` bounds that to one push, fixed forward by the lane that caused it.
- The operator's machine runs filtered gates and never two whole-tree gates at once. The whole-tree gate on Linux is the one that counts, which is where it already passed.
- A lane's database is created once by `pnpm db:lane` and never named by hand; a spike worktree gets one the same way.
- Opening or shipping a lane touches one file under `docs/plan/lanes/` and one link line. Notes and the changelog never conflict.
- The starter merge in a fork is one explicit command; a lane merge in a fork behaves like any merge.
- `.claude/settings.json` allows what §1 runs unattended: `git push`, `git merge`, `git worktree`, `pnpm land*`, `gh run *`.
- A fork inherits all of this with the records, and its first lane opens alone on `lane/S1`.

## Alternatives considered

- **Keeping the local gate as the proof and adding coordination between sessions.** Measured on the first day: agents watching each other, stale work, and four port-forward timeouts. Coordination is the cost this record removes.
- **The machine as the authority, the whole tree gated locally before each push.** It keeps the whole-tree gate on the laptop that overloaded, and re-runs it whenever `main` moves — the loop this record removes.
- **Re-running the lane gate whenever `main` moves.** Correct and unbounded: a lane whose gate outlasts another lane's steps never lands.
- **The merge queue as first scoped.** Unavailable here (§6).
- **A lane per Postgres container.** Isolates nothing the database name does not, and doubles what Docker Desktop forwards.
- **Union merge on the ledger and the records.** Would produce prose that reads wrong without a conflict to say so; union is for files with one writer and appends only.
- **Keeping `merge=ours` and documenting the risk.** A silent data loss with a paragraph beside it is still a silent data loss.
