# ADR-0079: Parallel lanes — more than one deliverable in progress when their records are disjoint (supersedes ADR-0025 in part — delta)

- Status: proposed
- Date: 2026-09-29
- Supersedes (at the step that makes the delta true): [ADR-0025](0025-deliverables.md) rule 5 as carried by [ADR-0065](0065-starter-lifecycle.md) and [ADR-0068](0068-behaviour-specs-and-plan-notes.md) (delta: how many deliverables may be in progress, and on what condition — what a deliverable is, that a window belongs to a deliverable and to its records only, acceptance at the head of the building step and the executable checklist that closes one all stand). Every parent stands for everything not named here.

> Written 2026-09-29 by `/scope` for D30 ([`docs/plan/0030-parallel-lanes.md`](../plan/0030-parallel-lanes.md)), with D22 in progress and D29 scoped, on the operator's question of the same day — writing is not opening, opening is not accepting. `proposed`; accepted at the head of `D30.1`. ADR-0025 rule 5 asked for this record in its own words: "If that constraint ever costs more than it saves, it is a decision to revisit here, not to quietly break."

## Context

ADR-0025 rule 5 made deliverables sequential, one in progress at a time, and gave its reason: two open windows would mean two mutable sets of records, and a record mutable from one deliverable and frozen from the other. It was written for a small number of people working on one thing at a time.

That is no longer how the tree is worked. Sessions run side by side, on the operator's machine and in the cloud, and the day this record was written had D22 in progress in one and D29 scoped and waiting in the other. The rule said the second could not open, and the reason it gave did not apply: [ADR-0077](0077-shared-composition-second-wave.md) and [ADR-0078](0078-backend-closing-wave.md) touch no record in common, and the code under them is the frontend of one wave and the backend of the other.

What the rule protects is narrower than what it forbids. Git already merges parallel code. What cannot be merged is semantic: which record is mutable, and which record is in force per topic. Those are properties of records, not of deliverables. The surfaces every step writes — the ledger's window section, the ADR index, the digests, the changelog, the migration journal — are single files, but each is edited by the row, and a conflict between rows is mechanical.

The starter is about to be forked (the ledger's §How D22 was scoped). A project inherits the records and not the ledger ([`docs/forking.md`](../forking.md)), so the rule the projects work under is whichever is written here before the fork.

## Decision

A **delta** on ADR-0025 rule 5. Every other decision of ADR-0025, as carried, stands and is in force as part of this record.

### 1. Deliverables in progress at once are disjoint in their records

More than one deliverable may be in progress when no record belongs to two of them. A deliverable's records are the ones its plan names: the records it writes, every parent those records supersede, and every record it amends in place. Two deliverables in progress share none of these. Each one is a **lane**.

The condition is checked when a lane opens, against every lane already open, and it is checked by a test rather than a reader: a hygiene case reads the ledger's window section and fails when two open lanes name one record. A deliverable whose records overlap an open lane's waits for that lane to ship, as every deliverable did before this record.

A lane's window is what ADR-0025 rule 2 already makes it: its own records, amendable in place and labelled, and nothing else. Opening a second lane reopens nothing.

### 2. The window section names every open lane

The ledger's window section stays the one place that says which windows are open (ADR-0065 §5). It carries one entry per open lane — the deliverable, the date it opened and its records — above the running paragraph on which records are closed. A single lane reads as it does today, and the hygiene case of §1 reads the entries.

### 3. One lane owns the schema

At most one open lane adds migrations. The journal is one file every migration edits, and a merge of two lanes' entries is a conflict resolved by hand at every step; ADR-0078 §1 makes a merged entry apply and does not make the merge free. A plan that adds a migration says so at scoping, and the hygiene case of §1 refuses a second such lane.

### 4. A lane is a branch that merges to `main` by the step

Each lane builds on a branch of its own, named for its deliverable and cut from `main` after the scoping commit lands there. Numbers — the deliverable's and its records' — are reserved by scoping on `main`, serially, so two lanes cannot claim one.

A lane merges `main` into itself before a step's gate runs, so the gate runs over the merged tree; a step that ends green merges to `main`, and `main` is where `/ship` runs. A step is not closed while `main` does not carry it. The shared surfaces — the ledger, the index, the changelog — merge by the row; a conflict in a digest is resolved by regenerating it, never by editing the merge.

### 5. The skills name the lane

`/step`, `/steps` and `/ship` take the deliverable as their argument while more than one row is in progress, and refuse a bare call then. `/steps` stays in its lane, as it already does. `/scope` writes a plan's records where the check of §1 can read them, and opening stays the operator's decision.

### 6. What this record declines

- **Parallel steps inside one lane.** Steps stay sequential within a deliverable; a plan is a build order.
- **Sharing a record between lanes by agreement.** A record with two open windows is the case rule 5 was written against, and it stays forbidden.
- **A lane per fork.** A project is a fork that supersedes and never merges its journal back ([`docs/forking.md`](../forking.md)); a lane is work on one tree.

## Consequences

- The starter's last wave can run beside other work: D29's records are disjoint from D22's, and from any feature that touches neither.
- Every step ends with a merge of `main` and a merge to `main`. Row-level conflicts in the ledger and the index become routine, and are resolved by hand.
- The operator's running stack serves every lane. A lane that changes an environment variable or a Dockerfile restarts the stack the other lanes attach to, and the restart is still reported and never taken (`CLAUDE.md`).
- A reviewer of a step reads the lane's branch against `main`, not against the other lanes.
- A fork inherits this rule with the records; its ledger is its own, and its first lane opens alone.

## Alternatives considered

- **Keeping rule 5 as written.** The right rule for one person; with sessions in parallel it serialises work whose records never meet, and its own text asked for the revisit.
- **A lane per record rather than per deliverable.** Finer, and it would let two lanes share one deliverable — the parallel-steps case declined at §6, with a plan that is no longer a build order.
- **Lanes that merge to `main` only at ship.** Longer branches, larger merges, and a `/ship` that resolves every conflict at once; the per-step merge keeps each small and keeps `main` the tree every session reads.
- **Two schema lanes, the journal merged by the hash runner.** The runner applies a merged entry; the merge is still a hand-resolved conflict on one file at every step, and one schema owner costs nothing while migrations are rare.
