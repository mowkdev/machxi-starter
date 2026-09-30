# ADR-0082: Lanes on one machine and one `main` — every lane a branch, every step a PR, the gate proportional to the diff, a test database per lane (supersedes ADR-0079, 0059, 0026, 0021, 0007, 0004 and 0065 in part — deltas)

- Status: proposed
- Date: 2026-09-30
- Supersedes (at the step that makes each delta true): [ADR-0079](0079-parallel-lanes.md) §2 and §4 (delta: every lane is a branch from its first step, a step lands on `main` only through a pull request the merge queue lands, and the open lanes are files the window section links); [ADR-0059](0059-ci-containers-and-deployment.md) §2 (delta: direct pushes to `main` stop; auto-merge and the merge queue are part of the setting a fork inherits); [ADR-0026](0026-task-graph-caching-and-serialisation.md) §The fast loop (delta: a step gates the packages its diff reaches; the whole tree gates once, on `main`; the two tiers that contend for a shared resource on one machine run under a lock); [ADR-0021](0021-testing-strategy.md) and [ADR-0007](0007-local-development-docker.md) (delta: the integration tier's database is one of a family, `machxi_<lane>_test`, derived from the branch); [ADR-0004](0004-configuration-and-environment.md) (delta: `packages/db/.env.test` joins the file layout, committed, so the db package's tier reads no untracked file); [ADR-0065](0065-starter-lifecycle.md) §3 (delta: `merge=ours` applies to the starter merge alone, never as a standing attribute a lane merge would hit). Every parent stands for everything not named here.

> Written 2026-09-30 by `/scope` for D34 ([`docs/plan/0034-lanes-on-one-machine.md`](../plan/0034-lanes-on-one-machine.md)), with D29 and D32 in progress, on the operator's review of the first two-lane day — writing is not opening, opening is not accepting. `proposed`; accepted at the head of `D34.1`.

## Context

ADR-0079 let two deliverables run at once when their records are disjoint, and the first day under it (D29 beside D31, then D32) proved the half it decided: the records stayed apart, and the only document conflicts were the ledger's running paragraph and one index row (§How D31 closed). What it did not decide was the machine, and the machine is where the day was lost:

- Both lanes' integration tiers rebuilt the same `machxi_test` at once — 91 cases deadlocked (`D29.1` notes). Each lane then got a database of its own by editing the tracked `apps/api/.env.test` under `skip-worktree`, an edit three notes files call "residual, for the operator to route".
- Each step of each lane ran the whole gate, cold, in its own worktree: two `tsc -b` sweeps, two Vite builds, two 800-case tiers on one laptop. Timing-sensitive tests flaked a different pair each run; the gate was run at `--concurrency=2` "to ease memory" (`D31.2`).
- Docker Desktop's port forward timed out under that load four times in a day, once on a lane running alone; the same commits gated green first time on a Linux runner (`D29.3`). `gate.yml` already runs the identical gate on every push to `main` and every pull request, and nothing waits for it.
- `main` moved under a step's gate twice, and every merge conflicted on the window paragraph (`D31.2`).
- `packages/db`'s integration tier reads the untracked root `.env` while the API's reads the tracked `apps/api/.env.test`, so a cloud session, which cannot read `.env`, lost a gate run to `DATABASE_URL_TEST_OWNER is not set` (`D32.1`).
- `.gitattributes` carries `docs/plan/** merge=ours`, and `/bootstrap` defines the driver in a fork's clone. Attributes apply to every merge, so in a fork the first lane merge would keep its own ledger and silently drop the other lane's. The starter has not seen it only because the driver is not configured here.

What the sessions did instead — checking each other before every suite run — is the most expensive coordination there is, and it produced stale work. The fix is not coordination. It is isolation where a lane needs it, a gate the size of the diff, and one serialised place where the whole tree is proved.

## Decision

Deltas on the parents named above. Everything else each of them decides stands and is in force as part of this record.

### 1. Every lane is a branch; every step lands through the merge queue

A lane builds on `lane/D<n>` from its first step, whether or not another lane is open; the allowance in ADR-0079 §4 for a lone lane to build on `main` is withdrawn, so `/step` has one shape. A step closes by opening a pull request from the lane branch and asking GitHub to land it when the required check passes (`gh pr merge --auto --squash`); the merge queue rebases the step onto the current tip, runs `gate.yml`, and lands it. **A step is closed when `main` carries it and CI proved it there.** Nobody merges to `main` by hand, and ADR-0059 §2's allowance for direct pushes ends: `main` is protected with `gate` required, auto-merge on and the merge queue on — repository settings a fork inherits by convention, recorded here as the setting the starter expects. One commit per step on `main`, titled with the step's conventional message; the PR body carries the review findings and their fates.

The next step of a lane does not wait for the queue: it starts on the lane branch, and merges `main` in before its own gate, which is where a step that went red in the queue is found. `/steps`' rule of one retry then stop applies unchanged. `/ship` runs on `main` as fetched from `origin`.

An offline fallback exists and is the operator's explicit choice per session (`/step --local`), never the agent's when a push fails: a `--ff-only` merge under the lock of §2, the whole-tree gate on `main` under the same lock.

### 2. The gate is proportional to the diff; the whole tree gates once

`CLAUDE.md` §Commands defines two commands, each once. **The lane gate**, what a step runs before it opens its PR: the gate's links over `--filter="...[main]"` — every package whose files differ from `main` and everything that depends on one — with `size` only when an SPA or a platform package is in that set, and `format:check` over the tree. **The gate** (unchanged): the whole tree, on `main`, by `gate.yml`; on the operator's machine only under §1's fallback. ADR-0026's rule that a contended task runs at `--concurrency=1` is kept and extended: on one machine the tiers that contend across lanes — `test:int`, `size`, `test:e2e` — run under a repository-level lock (`scripts/with-lock.mjs`), so a second lane waits and prints who holds it rather than colliding or asking.

A worktree may point `TURBO_CACHE_DIR` at one cache beside the checkouts; ADR-0026's purity rule is what makes a hit from another lane's run correct.

### 3. A test database per lane, derived and never edited

The integration tier's database is `machxi_<lane>_test`, where `<lane>` is the slug of the current branch (`lane/D29` → `d29`, `spike/d29-rls` → `spike-d29-rls`), and `machxi_test` when the branch is `main` or `TEST_DB_LANE` is unset. The harness — `apps/api/test/setup/env.ts` and `@repo/db/testing` — rewrites the database name of `DATABASE_URL_TEST` and `DATABASE_URL_TEST_OWNER` after the env files load; the `_test` suffix guard stays underneath. `/step` sets `TEST_DB_LANE` from the branch; `pnpm db:lane` takes no argument and creates the current branch's database with `machxi_test`'s owner and grants, idempotently. `TEST_DB_LANE` is declared in `turbo.json` for `test` and `test:int`, per ADR-0026. `packages/db/.env.test` is committed beside the API's, the same shape, so neither tier reads an untracked file and a cloud session gates from a clone.

### 4. Shared surfaces that do not conflict

Each open lane is a file, `docs/plan/lanes/D<n>.md`, in the shape ADR-0079 §2 gave the entry; the ledger's window section lists them by link, and `pnpm docs:check` reads the files. The running paragraph under the list is written by `pnpm lanes` from the files and refused by `docs:check` when stale, the way the digests are. `docs/plan/*.notes.md` and `docs/CHANGELOG.md` merge by `union`: one writer each, appends only. The `docs/plan/** merge=ours` attribute is removed; the starter merge applies the driver on the command line (`git -c merge.ours.driver=true merge starter/main`), which is what `/bootstrap` and `docs/forking.md` say.

### 5. Tiers of lane

A plan's header carries `- Tier: package | api | schema` beside `- Schema:`. `schema` lanes are at most one (ADR-0079 §3, unchanged); `api` lanes each take a database under §3; `package` lanes need no Postgres and no build, and any number may be open. The tier names which gate `/step` runs and which machine the lane can live on. `docs:check` reads it from the lane file.

### 6. What this record declines

- **Parallel steps inside one lane**, and **a record shared by agreement** — ADR-0079 §6 stands.
- **A required human approval on `main`.** It would stop auto-merge from ever landing an unattended step; the bounded review stays where it is, before the commit.
- **The browser tier in either gate.** ADR-0052 and ADR-0059 §1 stand.
- **A Postgres container per lane.** One container, one database per lane, is enough; what failed was the port forward under two whole-tree gates, and §2 removes those.

## Consequences

- A step's close waits on a CI run; the lane's next step does not. `main` is always a tree CI proved.
- The operator's machine runs filtered gates and never two whole-tree gates at once. The whole-tree gate on Linux is the one that counts, which is where it already passed.
- A lane's database is created once by `pnpm db:lane` and never named by hand; a spike worktree gets one the same way.
- Opening or shipping a lane touches one file under `docs/plan/lanes/` and one link line. Notes and the changelog never conflict.
- The starter merge in a fork is one explicit command; a lane merge in a fork behaves like any merge.
- `.claude/settings.json` allows what §1 runs unattended: `git push` of a lane branch, `git merge`, `git worktree`, `gh pr *`, `gh run *`.
- A fork inherits all of this with the records, and its first lane opens alone on `lane/S1`.

## Alternatives considered

- **Keeping the local gate as the proof and adding coordination between sessions.** Measured on the first day: agents watching each other, stale work, and four port-forward timeouts. Coordination is the cost this record removes.
- **The machine as the authority with a local queue only.** Works offline and is kept as the fallback; as the default it keeps the whole-tree gate on the laptop that overloaded and leaves cloud lanes with no way to land.
- **A lane per Postgres container.** Isolates nothing the database name does not, and doubles what Docker Desktop forwards.
- **Union merge on the ledger and the records.** Would produce prose that reads wrong without a conflict to say so; union is for files with one writer and appends only.
- **Keeping `merge=ours` and documenting the risk.** A silent data loss with a paragraph beside it is still a silent data loss.
