# ADR-0025: Deliverables: the unit of staged work and how it binds the ADR lifecycle

- Status: accepted
- Date: 2026-08-18

## Context

This repository has built one thing and is about to start a second, and it has no word for either.

The concept exists, half-named, in three places. `docs/implementation-plan.md` is titled "first deliverable". `docs/adr/README.md` closes with a section called "First deliverable — delivered 2026-08-18". [ADR-0022](0022-frontend-apps.md) says building the frontend apps "is the next deliverable, not this one". Three files, one idea, no identifier — and nothing that says what a deliverable is, when it opens, or what closes it.

Two mechanisms already depend on that missing identifier.

**The ADR index's _Implemented_ column names build steps** — `step 7`, `steps 8–9` — from a globally numbered list that runs 1 to 11 because there has only ever been one plan. The moment a second plan has its own step 1, every one of those cells becomes ambiguous, and the column [ADR-0024](0024-adr-lifecycle.md) §Lifecycle rule 4 introduced to answer "is this decision theory or load-bearing?" stops answering it.

**ADR-0024 §Lifecycle rule 2 is already scoped to an area rather than a date.** It says an accepted ADR with no code standing on it may be amended in place, and then: "The condition is the code, not the calendar. A decision written ahead of the system it governs carries this exception until that system exists, which is why the rule is stated this way and not as 'before 2026-08-18' — the next greenfield area of this blueprint gets the same latitude the API had." Rule 3 then closes the window for ADRs 0001–0023 by naming a date, because on 2026-08-18 there was exactly one area and closing it was the same event as shipping.

So the rule is right and unusable: it turns on "which area", and nothing names areas. Judging it ad hoc has already produced one confusing state — ADR-0022 is `accepted` with _Implemented: step 1 only_, which reads as both built and unbuilt, because the part of it that is implemented (frameworks, ports, versions) and the part that is not (the apps) belong to different deliverables and the record has no way to say so.

The last plan file is 62 KB for one deliverable. Appending a second and a third to it produces a document nobody opens, and the plan is where the reasoning under pressure is kept — the part that is genuinely hard to reconstruct later.

## Decision

A **deliverable** is the unit of staged work in this repository. It is the thing that opens and closes an ADR-0024 amendment window, the thing a plan file describes, and the thing a step number is scoped to.

We use the word "deliverable" because three existing documents already use it. One word, everywhere; "stage", "phase" and "milestone" are not synonyms in this tree, they are absent from it.

### Identity

Deliverables are numbered from 1 in the order they are started, written `D1`, `D2`. A number is never reused and never renumbered — the ADR index and the git history both point at them.

`D1` is the API foundation, shipped 2026-08-18. It is numbered retroactively; nothing about it changes except what it is called.

### Plan files

One file per deliverable, in `docs/plan/`:

```
docs/plan/
├── README.md                      # the ledger: every deliverable, its status, its scope in one line
├── 0001-api-foundation.md         # D1 — was docs/implementation-plan.md, content unchanged
└── 0002-….md                      # D2 — the current one
```

`docs/plan/README.md` is the ledger and is the file to read first. It carries one row per deliverable: number, title, status (`planned` | `in progress` | `shipped YYYY-MM-DD`), a one-line scope, and a link. It is the plan's equivalent of the ADR index, and it exists for the same reason: a directory of long documents needs a short one that says which to open.

A deliverable's plan file carries what `docs/implementation-plan.md` carried for D1 — the scope, the numbered build order, the hand-offs between steps, and the definition of done. Closed steps keep their notes. The plan is the record of what was decided under pressure and why; the ADRs are the record of what was decided. Neither replaces the other.

### Step identity

A step is written `D<deliverable>.<step>`: `D1.7`, `D2.3`. Within a plan file the steps stay numbered `1.`, `2.`, `3.` — the prefix is how a step is referred to from outside, which is where the ambiguity was.

The ADR index's _Implemented_ column uses the prefixed form. Rewriting the existing cells from `step 7` to `D1.7` edits `docs/adr/README.md` and nothing else, which ADR-0024 rule 4 designates as the file that records implementation; it amends no ADR.

### Binding to the ADR lifecycle

1. **An ADR belongs to the deliverable that first puts code under it.** That deliverable is what its _Implemented_ cell names. An ADR that several deliverables grow the surface of lists them all, exactly as the column already does for steps — the decision was made once, and saying so twice would invite the reader to look for two decisions.

2. **The ADR-0024 rule 2 amendment window is scoped to a deliverable, and it is opened and closed by that deliverable, not by a date.** An ADR written for `D<n>` may be amended in place while `D<n>` is in progress, dated and labelled `**Amended YYYY-MM-DD (D<n>.<step>).**` at the point of change. It becomes immutable when `D<n>` closes.

   Opening `D<n+1>` opens a window only for the ADRs written for it. It reopens nothing. An ADR that shipped under a closed deliverable changes the way ADR-0024 rule 1 says any load-bearing decision changes: by a superseding ADR that carries the whole decision.

   This is the rule ADR-0024 already stated; what this ADR adds is the name of the thing it turns on, so the question "is this ADR still amendable?" is answered by looking up its deliverable's status in the ledger rather than by arguing about whether code counts as standing on it.

3. **An ADR can belong to a deliverable that has not started.** Its _Implemented_ cell names the deliverable and stays otherwise empty — `D2 (not yet built)` — which is the honest state for a decision written ahead of its code, and the state ADR-0024 rule 2 exists to serve. `Status: proposed` and "belongs to D2" are different facts: the first says the decision is not agreed, the second says it is not built.

4. **A deliverable closes on an executable acceptance checklist.** D1's is [ADR-0021](0021-testing-strategy.md) §Acceptance checklist, whose last steps are `pnpm test:postman`, `pnpm test` and `pnpm lint && pnpm check-types`. Every deliverable states its own in its plan file, and every deliverable's checklist must be something a person can run on a fresh clone and watch pass or fail. A deliverable that closes on a judgement call closes whenever somebody is tired.

   Closing is an event with three parts: the checklist passes, the ledger row moves to `shipped YYYY-MM-DD`, and the amendment window shuts. They happen together or the deliverable is not closed.

5. **Deliverables are sequential, and one is in progress at a time.** This is a blueprint repository built by a small number of people; parallel deliverables would mean two open amendment windows and an ADR that is mutable from one and frozen from the other. If that constraint ever costs more than it saves, it is a decision to revisit here, not to quietly break.

### Where deliverables are not

Nothing is added to any ADR's front matter. An ADR does not carry a `Deliverable:` field, for the reason ADR-0024 rule 4 gives about `Status: implemented`: an ADR cannot know when it will be built, and editing accepted files to tell them is what rule 1 forbids. The mapping lives in the index, in one column, where it is maintained as a single edit when code lands.

## Consequences

- The question "may I amend this ADR?" has a mechanical answer: find its deliverable in `docs/plan/README.md`; if that row says `in progress`, yes; otherwise write a superseding ADR. It stops being a judgement about how much code counts.
- ADR-0022's split state becomes expressible. Its _Implemented_ cell says `D1.1` for the configuration it decided and names `D2` for the apps it does not, and neither half has to pretend to be the other.
- The ADR index gains a second standing duty alongside rule 4's: cells are written in the `D<n>.<step>` form, and the one-time rewrite of D1's eleven steps is part of accepting this ADR.
- The plan stops being one growing file. The cost is a directory and a ledger to keep current; the ledger is three lines today and is the only file that has to be edited when a deliverable's status changes.
- Rule 5 will be the first to come under pressure — the frontend apps of ADR-0022 are two apps and look parallelisable. They are one deliverable with two apps in it unless and until this ADR says otherwise.
- Retroactively numbering D1 costs a rename of one file and a rewrite of one column. Doing it later costs the same rewrite plus every reference written in between.

## Alternatives considered

- **Git tags and repository milestones.** Free, and invisible: the ADR index cannot cite a tag, a fresh clone shows no structure, and the amendment window would turn on something outside the working tree. Tags are a fine addition on top; they are not a place to keep a rule.
- **A `Deliverable:` field in every ADR's front matter.** Twenty-four edits to accepted files, which is precisely the rule 1 violation ADR-0024 was written to stop, and it asks each ADR to know its own future. Rejected on ADR-0024's own argument.
- **Keep one growing `docs/implementation-plan.md`.** Already 62 KB after one deliverable. The step-numbering ambiguity would remain, since the steps are the plan's spine and a single file cannot restart them.
- **Call the unit a "release" and tie it to a version number.** A release is something that goes somewhere. This blueprint is cloned, not deployed, and D1 shipped to no environment. Naming the unit after an event that does not happen here would mean explaining, every time, that it does not.
- **Define the unit but leave the ADR lifecycle alone**, letting rule 2 stay a judgement call. That is the current state, and it produced ADR-0022's ambiguous cell within a day of ADR-0024 being written.
