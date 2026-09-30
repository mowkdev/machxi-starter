# D36 — Fork readiness

- Status: **planned** — **scoped in full 2026-09-30 by `/scope`**, the day D34 shipped, from the fork-readiness review and on the operator's decisions (ledger §How D36 was scoped). The last starter deliverable before the fork.
- Records: [ADR-0084](../adr/0084-fork-readiness.md) (a scripted bootstrap and a rehearsed fork, the starter merge removing every journal file it brings, the commit behind the metrics token) — written `proposed` at scoping, accepted at the head of `D36.1`. Parents it supersedes in part: [ADR-0065](../adr/0065-starter-lifecycle.md), [ADR-0082](../adr/0082-lanes-on-one-machine-and-one-main.md), [ADR-0081](../adr/0081-build-versions.md). Amends none. **Adds no migration.**
- Schema: no
- Tier: api (`/health` and its integration tests; the fork rehearsal runs the script tier)
- Ledger: [`docs/plan/README.md`](README.md)
- Notes: [`0036-fork-readiness.notes.md`](0036-fork-readiness.notes.md)

## Goal

A fork of the starter works on its first day, and a test proves it on every push: the journal reset is a script, and a rehearsal bootstraps a temporary clone, merges a simulated starter change into it with the documented commands, and runs the fork's checks. The small defects a fork would otherwise inherit are closed before it forks. After D36 the ledger holds nothing a fork needs first.

## Constraints

- Records are immutable once accepted. A parent moves to `superseded by` at the step that makes its delta true, and its body is untouched (ADR-0050 rule 1 as carried by ADR-0065).
- The starter merge's drivers and the journal attributes of ADR-0082 §4 are unchanged. Only the cleanup after the merge changes (ADR-0084 §2).
- The rehearsal runs offline, in a temporary directory, reading no global git config. It never touches the repository it runs in (ADR-0084 §1; the same discipline as `scripts/merge-attributes.test.mjs`).
- `.claude/**` carries no step number, no date and no bare record range (`pnpm docs:check`, ADR-0065 §5).
- Every action stays pinned to a commit digest with its tag in a comment (ADR-0073 §7 as carried).
- The browser tier stays beside the gate, never in it (ADR-0052, ADR-0059 §1).
- D36 runs in the shape ADR-0082 decides: one pull request, each step a commit ending green on `pnpm step:check`, and the whole gate once, at ship.

## Decisions taken at scoping (operator, 2026-09-30)

- **Bootstrap becomes a script, proved by a rehearsal test**, rather than a document fix and one more dry run.
- **Every small carry-over is fixed now:** CI hygiene, the SPA images on IPv4-only hosts, `/health`'s commit, and the admin flake.
- **The links in carried records to the starter's plans stay** as history, read at `starter/main`. The non-record documents stop linking to specific starter plans, and `docs:check` checks their links.
- **Renovate:** the operator installs the app. D36 changes nothing about it, and `docs/forking.md` tells a fork to install it.

## Steps

Each step: read the last push's run, implement, `pnpm step:check` green, one bounded review in a fresh context, one commit pushed to the lane's pull request (ADR-0082 §1–§2). ADRs listed are what the builder reads first.

- [ ] **1. Accept ADR-0084; the journal reset as a script; the script tests fork-safe.** Accept 0084 at the head, where [ADR-0065](../adr/0065-starter-lifecycle.md)'s status line gains its §3 and §5 delta, with the index rows and the topic table. `scripts/bootstrap.mjs` (`pnpm bootstrap --prefix <name>`) does ADR-0084 §1's reset. The tests that read the starter's own journal stop depending on it: `docs-hygiene.test.mjs`'s D34-plan case reads a fixture, and its exemption count asserts only when plans exist. `db-lane.test.mjs`'s length case derives the base name's length rather than hard-coding it. `scripts/rename.mjs` formats the files it rewrites.
      **ADRs:** 0084 §1, 0065 §3 and §5 as carried, 0082 §4 and §5.
      **Done when:** `scripts/bootstrap.test.mjs` cases "a fresh clone bootstraps to an empty ledger under the given prefix", "the starter's plans, notes and lane files are removed and lanes/README.md is kept", "the ledger carries no link to the frozen history", "the changelog is its preamble under the fork's prefix", "the generated block reads no lane open" and "a tree that is not a fresh starter clone is refused" green; `scripts/rename.test.mjs` case "the renamed files pass format:check" green; `pnpm step:check` green.
- [ ] **2. The fork rehearsed; the starter merge removes every journal file it brings.** `docs/forking.md` §5's cleanup becomes ADR-0084 §2's. It removes every file the merge added under `docs/plan/` with `git rm -qf`, resolves a modify/delete under `docs/plan/` by deletion, and names the tag as `starter-D<n>`. `docs/upstreaming.md`'s merge-down runs the same commands. `scripts/fork-rehearsal.test.mjs` does ADR-0084 §1's rehearsal and reads the merge commands from `docs/forking.md`, so the document and the test cannot drift. [ADR-0082](../adr/0082-lanes-on-one-machine-and-one-main.md)'s status line gains its §4 delta.
      **ADRs:** 0084 §1 and §2, 0082 §4, 0065 §4.
      **Done when:** `scripts/fork-rehearsal.test.mjs` cases "the bootstrapped fork passes docs:check and its script tests", "a starter ship that edits a plan the fork deleted merges with the documented commands", "the starter's added plans, notes and lane files are gone after the documented commands", "the fork's ledger, changelog and notes are unchanged by the merge", "the fork passes docs:check after the merge" and "upstreaming.md's merge-down runs the same commands as forking.md" green; `scripts/merge-attributes.test.mjs` case "a conflicted starter merge's added lane file is removed by git rm -qf" green; `pnpm step:check` green.
- [ ] **3. The commit behind the metrics token.** `/health` answers `commit` only to a request carrying the configured metrics token (ADR-0084 §3). An unauthenticated caller gets `version` alone. [ADR-0081](../adr/0081-build-versions.md)'s status line gains its §3 delta. `docs/specs/health-and-metrics.md` states it, and the Postman collection's health request shows both calls.
      **ADRs:** 0084 §3, 0081 §3, 0016 as carried, 0013.
      **Done when:** `apps/api/test/health.int.test.ts` cases "an unauthenticated /health answers the version and no commit", "a /health carrying the metrics token answers the commit" and "a wrong token answers no commit and no error" green; `health-and-metrics.md`'s scenarios name those tests (`pnpm docs:check`); `pnpm step:check` green.
- [ ] **4. The carry-overs a fork should not inherit.**
  - `gate.yml` groups `main`'s runs by commit, so a queued run on `main` is never dropped, and its comment says so truly.
  - The actions still on the deprecated Node 20 runtime move to their current majors, digest-pinned with the tag in a comment.
  - Both SPA `nginx.conf` files start on a host without IPv6.
  - `apps/admin/src/app/__tests__/settings-provider.test.tsx`'s theme check retries under `waitFor`.
    **ADRs:** 0073 §7 as carried, 0059 §1 and §2 as carried by 0082, 0078 §5.
    **Done when:** `scripts/docs-hygiene.test.mjs` cases "a gate.yml run on main is grouped by commit" and "every workflow action is pinned to a commit digest" (existing) green; `scripts/images.test.mjs` case "neither SPA's nginx.conf requires an IPv6 socket" green; `apps/admin/src/app/__tests__/settings-provider.test.tsx` case "adopts the account's theme when the query resolves" green ten times in a row, `pnpm --filter admin exec vitest run settings-provider --repeat 10`, recorded in the notes; the pull request's `gate.yml` run green on the step's commit with no Node 20 deprecation annotation (recorded in the notes); `pnpm step:check` green.
- [ ] **5. What a fork reads on day one.**
  - `docs/forking.md` opens with one fork-day checklist:
    - clone and `pnpm bootstrap`;
    - rename, then licence;
    - record the starter tag forked at;
    - install the Renovate app;
    - branch protection on `main`;
    - [`docs/deploy.md`](../deploy.md)'s "Before the first deploy" and its required variables;
    - tags a cloud session cannot push are pushed by the operator.
  - `/bootstrap` runs `pnpm bootstrap` and ends on `pnpm docs:check` and the script tests green.
  - `/scope` writes the first row on an empty ledger.
  - `README.md` and `docs/postman/README.md` stop linking to specific starter plans.
  - `docs/forking.md` says a carried record's plan link is read at `starter/main`.
  - `pnpm docs:check` checks relative links in the carried non-record documents: `README.md`, `docs/*.md`, `docs/specs/**`, `docs/rules/**` and `.claude/**`.
  - The ADR index's stale "D14 owns `apps/web`" line names D16.
  - `.claude/README.md`, the digests' sources and the skills say what changed.
    **ADRs:** 0084, 0065 §1 and §3, 0068.
    **Done when:** `scripts/docs-hygiene.test.mjs` cases "a broken relative link in a carried document is refused", "a link from a record to a plan is not a carried document's" and "this repository's carried documents have no broken link" green; `scripts/fork-rehearsal.test.mjs` case "the bootstrapped fork's /scope preconditions hold: a prefix, an empty ledger, the generated block" green; `pnpm step:check` green.

## Definition of done

Run by `/ship` on the lane's head with `main` merged in.

1. The gate green by `gate.yml` on the pull request's head, and on the machine once under the lock: `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check`.
2. `pnpm test:unit` twice, the second `FULL TURBO`.
3. `pnpm rules:digest` and `pnpm lanes` each write nothing on a second run; `pnpm docs:check` clean; `pnpm test:scripts` green, the fork rehearsal among it.
4. `e2e.yml` dispatched on the lane's head, both apps green: the browser tier proven on the tree the fork will take.
5. **Pending the operator, named:**
   - The tags `starter-D29`, `starter-D34` and `starter-D35` are on `origin`, pushed by the operator, because a cloud session's pushes of `refs/tags/` are cut off.
   - `pnpm test:postman` passes against the operator's stack for the health change.
   - The Renovate app is installed, and branch protection on `main` is set or recorded as not available.
   - The four stale remote branches are deleted.
6. A clean tree.

## Not in D36

These are carried knowingly, each recorded where it lives:

- **Planned after the fork:** D16 (the marketing site), D24's remainder (the scheduler seam and the mail outbox), D26 (record consolidation) and D33 (version-mismatch reload). The ledger places all four after the fork.
- **Security residuals accepted at Low:**
  - the previous JWT secret never expires, and tokens without a key id are accepted;
  - a password login takes no credential lock;
  - D35's logged Lows;
  - the version values have no length bound;
  - no per-request principal check;
  - no step-up authentication;
  - no retention policy for soft-deleted accounts;
  - the pre-hijack registration risk.
- **Image hardening remainders:** the SPA stages install the whole workspace, base images are pinned by tag, and `conf.d` is writable by uid 101.
- **Flakes under load**, other than the admin theme case: the staff-delete race's status and the concurrency cases under Docker Desktop. D34's lock and lane database are their mitigation.
