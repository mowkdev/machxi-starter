# D34 — Lanes on one machine and one `main`

- Status: **planned** — **scoped in full 2026-09-30 by `/scope`**, on the operator's review of the first two-lane day, with D29 and D32 in progress (ledger §How D34 was scoped). Not opened: its records meet both open lanes' ([ADR-0059](../adr/0059-ci-containers-and-deployment.md) is in D29's set; [ADR-0004](../adr/0004-configuration-and-environment.md) and [ADR-0065](../adr/0065-starter-lifecycle.md) are in D32's), so it opens alone once both have shipped, as the last starter deliverable before the fork.
- Records: [ADR-0082](../adr/0082-lanes-on-one-machine-and-one-main.md) (every lane a branch, every step a PR the merge queue lands, the gate proportional to the diff, a test database per lane, shared surfaces that do not conflict, tiers of lane) — written `proposed` at scoping, accepted at the head of `D34.1`. Parents it supersedes in part: [ADR-0079](../adr/0079-parallel-lanes.md), [ADR-0059](../adr/0059-ci-containers-and-deployment.md), [ADR-0026](../adr/0026-task-graph-caching-and-serialisation.md), [ADR-0021](../adr/0021-testing-strategy.md), [ADR-0007](../adr/0007-local-development-docker.md), [ADR-0004](../adr/0004-configuration-and-environment.md), [ADR-0065](../adr/0065-starter-lifecycle.md). Amends none. **Adds no migration.**
- Schema: no
- Tier: package (the vocabulary this deliverable introduces; no Postgres beyond the harness's own tests, no SPA build)
- Ledger: [`docs/plan/README.md`](README.md)
- Notes: [`0034-lanes-on-one-machine.notes.md`](0034-lanes-on-one-machine.notes.md)

## Goal

Two lanes on one machine stop competing for one database, one CPU and one `main`. A step gates the packages its diff reaches and lands on `main` through the merge queue, where CI proves the whole tree once; a lane's test database is derived from its branch and never named by hand; the shared documents stop conflicting. It lands before the fork so machxi-ship's carrier lanes inherit the rule with the records rather than the failure with the memory.

## Constraints

- Window and supersession state is written in the ledger's window section and nowhere else, and after `D34.4` the lane entries are files that section links (ADR-0065 §5 as carried; ADR-0082 §4).
- A cached task is a pure function of the tree and the declared environment; `TEST_DB_LANE` is declared in `turbo.json` for `test` and `test:int` (ADR-0026 §The rule).
- The `_test` suffix guard on the test database stays underneath every lane database (ADR-0008, `@repo/db/testing`).
- `.claude/**` carries no step number, no date and no bare record range; `pnpm docs:check` enforces it (ADR-0065 §5).
- A superseding record states its delta and each parent's status line names it at the step that makes the delta true; the parent's body is untouched (ADR-0050 rule 1 as carried by ADR-0065).
- The browser tier stays beside the gate, never in it (ADR-0052, ADR-0059 §1).
- D34 opens alone: D29 and D32 have shipped before it opens (ADR-0079 §1 — its records meet theirs).
- The gate as `CLAUDE.md` §Commands defines it, at every step; from `D34.5` the step's own PR is the proof.

## Decisions taken at scoping (2026-09-30)

Taken in the review sitting of the same day (the review is kept in the project's Claude space as `parallel-lanes-review`) and confirmed by the operator there; recorded here so a builder does not re-open them.

- **CI is the authority for `main`.** A step lands through the merge queue; the local `--ff-only` path is an operator-chosen fallback (`/step --local`), never the agent's answer to a failed push.
- **Every lane is a branch from its first step.** The lone-lane-on-`main` allowance is withdrawn.
- **Squash per step.** One commit per step on `main`, titled with the step's conventional message; review findings in the PR body.
- **Derive, don't validate.** `TEST_DB_LANE` comes from the branch name; `pnpm db:lane` takes no argument.
- **Union merge for notes and the changelog only.** The ledger and the records never union; they stop conflicting by becoming per-lane files and a generated paragraph.
- **`merge=ours` is applied on the command line for the starter merge**, not as a standing attribute.
- **Recorded, not asked:** steps within a lane stay sequential; no record is shared by agreement; no human approval is required on `main`; one Postgres container.

## Steps

Each step: implement, gate green, one bounded diff review, commit (ADR-0050). ADRs listed are what the builder reads first. Steps 1–4 close the old way (`/step` as it reads when D34 opens); step 5 is the first step that closes the new way, and its landing is its own proof.

- [ ] **1. Accept ADR-0082; a test database per lane.** Accept 0082 at the head, where [ADR-0021](../adr/0021-testing-strategy.md), [ADR-0007](../adr/0007-local-development-docker.md) and [ADR-0004](../adr/0004-configuration-and-environment.md)'s status lines gain their deltas (the index rows and the topic table say so). `apps/api/test/setup/env.ts` and `@repo/db/testing` rewrite the database name of both test URLs to `machxi_<lane>_test` when `TEST_DB_LANE` is set, after the env files load, with the suffix guard still underneath; `scripts/db-lane.mjs` (`pnpm db:lane`) slugs the current branch and creates that database with `machxi_test`'s owner and grants, idempotently, refusing `main`; `packages/db/.env.test` is committed in the API file's shape and `packages/db/vitest.int.config.ts` loads it; `TEST_DB_LANE` joins `turbo.json`'s `env` for `test` and `test:int`; `.env.example` and the config record entry name it; `/local-dev` says how a lane gets its database.
      **ADRs:** 0082 §3, 0021, 0007 as carried by 0061, 0004 as carried by 0075, 0026 §The rule.
      **Done when:** `apps/api/test/setup/env.test.ts` cases "rewrites both test URLs to the lane database when TEST_DB_LANE is set" and "leaves both URLs alone when TEST_DB_LANE is unset" green; `packages/db/src/__tests__/testing.test.ts` case "a lane database still has to end in _test" green; `scripts/db-lane.test.mjs` cases "lane/D29 slugs to d29", "spike/d29-rls slugs to spike-d29-rls" and "main is refused" green; `pnpm test:int --filter api` on a branch with `TEST_DB_LANE` set runs against the lane database (the notes record the name from the run's log); `pnpm test:int --filter @repo/db` green from a clone with no root `.env`; `pnpm check` green.
- [ ] **2. The lane gate, the lock, and the permissions.** `CLAUDE.md` §Commands names the lane gate (the links over `--filter="...[main]"`, `size` only when an SPA or a platform package is affected, `format:check` over the tree) beside the gate, each once; [ADR-0026](../adr/0026-task-graph-caching-and-serialisation.md)'s status line gains its delta. `scripts/with-lock.mjs` takes a named lock directory beside the checkouts, waits with a timeout, prints the holder, runs the command, releases; `/step` wraps `test:int`, `size` and `test:e2e` in it and gates with the lane gate; `gate-runner` knows both commands; `.claude/settings.json` allows `git push`, `git merge`, `git worktree`, `gh pr *` and `gh run *`; `.claude/README.md` says why. `TURBO_CACHE_DIR` is documented as the shared cache a worktree may point at.
      **ADRs:** 0082 §2, 0026 as carried by 0052, 0073 and 0074, 0059 §1.
      **Done when:** `scripts/with-lock.test.mjs` cases "a second holder waits until the first releases", "a lock whose holder is gone is taken over" and "a timeout is reported, not skipped" green; `pnpm turbo run lint check-types test:unit --filter="...[main]"` on a branch that changes only `@repo/grid` runs the grid, the two SPAs and nothing under `apps/api` (the notes record the task list); `pnpm docs:check` clean; `pnpm test:scripts` green; `pnpm check` green.
- [ ] **3. `merge=ours` scoped to the starter merge; union for notes and the changelog.** `.gitattributes` drops `docs/plan/** merge=ours` and gains `docs/plan/*.notes.md merge=union` and `docs/CHANGELOG.md merge=union`; `/bootstrap` and `docs/forking.md` say the starter merge is `git -c merge.ours.driver=true merge starter/main` and no longer define the driver in the clone; [ADR-0065](../adr/0065-starter-lifecycle.md)'s status line gains its delta.
      **ADRs:** 0082 §4, 0065 §3 as carried by 0068 and 0074.
      **Done when:** `scripts/merge-attributes.test.mjs` (a temporary repository per case) cases "a lane merge keeps both sides of a notes file", "a lane merge keeps both sides of the changelog", "a lane merge of the ledger conflicts rather than dropping a side" and "the starter merge with the driver on the command line keeps ours" green; `pnpm docs:check` clean; `pnpm test:scripts` green.
- [ ] **4. Lane entries as files; the running paragraph generated; tiers.** `docs/plan/lanes/D<n>.md` holds an open lane's entry (deliverable, opened, records, schema, tier); the ledger's window section links the directory and carries the generated running paragraph; `scripts/lanes.mjs` (`pnpm lanes`) writes it from the files; `scripts/docs-hygiene.mjs` reads the files instead of the paragraph, keeps the three lane cases, refuses a stale paragraph and counts tiers (`schema` at most one); `/scope` writes `- Tier:` and offers opening as "create the lane file"; `/ship` removes it; [ADR-0079](../adr/0079-parallel-lanes.md)'s status line gains its §2 delta. D29's and D32's entries, if either is still open, move into files in this step.
      **ADRs:** 0082 §4 and §5, 0079 §2 and §3, 0065 §5.
      **Done when:** `scripts/docs-hygiene.test.mjs` cases "two open lanes never share a record", "a second lane on the schema is refused" and "one open lane reads as before" green against lane files; new cases "a stale running paragraph is refused" and "a tier the plan does not name is refused" green; `pnpm lanes` writes nothing on a second run; `pnpm docs:check` clean; `pnpm test:scripts` green.
- [ ] **5. Every lane a branch; every step a PR the queue lands.** `/step` closes a step by pushing the lane branch, opening or reusing the lane's PR with the review findings in its body, and `gh pr merge --auto --squash`; reports the step closed when `main` carries it; carries `--local` for the fallback under the lock; `/steps` starts the next step without waiting for the queue and merges `main` in before that step's gate; `/ship` runs on `main` as fetched; `/scope` cuts `lane/D<n>` at opening; [ADR-0079](../adr/0079-parallel-lanes.md) §4's and [ADR-0059](../adr/0059-ci-containers-and-deployment.md) §2's status lines gain their deltas; `docs/README.md`, `CLAUDE.md` and `.claude/README.md` read for the one shape. The repository settings — `gate` required on `main`, auto-merge on, merge queue on, direct pushes off — are the operator's and are named in the notes as accepted or pending.
      **ADRs:** 0082 §1 and §6, 0079 §4 and §6, 0059 §1 and §2, 0050.
      **Done when:** this step's own PR is landed on `main` by the merge queue with `gate` green (`gh pr view <n> --json mergedAt,mergeCommit` recorded in the notes); `pnpm docs:check` clean; `pnpm test:scripts` green.
- [ ] **6. Close-out.** `.claude/README.md` says how lanes run on one machine — the tier, the database, the lane gate, the lock, the queue; the digests regenerated; then the definition of done.
      **ADRs:** 0082, 0065 as carried.
      **Done when:** the definition of done below, every item.

## Definition of done

Run at `D34.6` and again by `/ship` on `main`.

1. The gate green on `main` by `gate.yml` for the shipping commit, and locally every task cold: `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check`.
2. `pnpm test:unit` twice, the second `FULL TURBO`.
3. `pnpm rules:digest` writes nothing on a second run; `pnpm lanes` writes nothing on a second run; `pnpm docs:check` clean; `pnpm test:scripts` green.
4. `D34.5`'s and `D34.6`'s PRs landed by the merge queue, recorded in the notes.
5. A clean tree afterwards.

## Not in D34

D33; moving any lane's history; a Postgres container per lane; the browser tier in a gate; a human approval on `main`; the fork's own ledger and its first lane (`docs/forking.md` already says a fork's first lane opens alone); the `- Tier:` line on plans already shipped.
