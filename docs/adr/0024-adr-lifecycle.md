# ADR-0024: ADR lifecycle: format, statuses and how a decision changes

- Status: accepted
- Date: 2026-08-18
- Supersedes: [ADR-0001](0001-record-architecture-decisions.md)

## Context

ADR-0001 established the practice and the MADR-lite format on 2026-08-17, the day before the first deliverable was built. It ruled that "accepted ADRs are not edited except to update `Status`" and that change is expressed by a superseding ADR. That is the right rule for a decision with code standing on it. It was the wrong rule for the eleven build steps that followed, during which the ADRs were the only thing that existed.

Those steps kept finding decisions the ADRs had not made, or had made against facts that did not survive contact with a compiler: `z.coerce.boolean()` turning the string `"false"` into `true`, so a feature flag could not be switched off; `drizzle-kit`'s migration table surviving a `DROP SCHEMA public`, so a "reset" database reported every migration as applied; `pino-http` reaching into a bundled `pino` through private symbols, so the first completed request crashed a server that passed every test. Roughly thirty such corrections were written into accepted ADRs as `Amended 2026-08-18 (step N)` blocks.

No ADR permitted any of them. The exception lived in `docs/adr/README.md` — the index — as one sentence: "Until the first deliverable ships, accepted ADRs may still be amended in place (the code does not exist yet, so there is nothing to supersede)". So the rule this repository leaned on hardest during its formative week was a footnote in a navigation file, contradicting the ADR it was an exception to. A reader who trusted ADR-0001 would count thirty violations of it.

The first deliverable shipped on 2026-08-18. The exception has expired, and what it was, why it was allowed and when it ended belong in the place decisions are recorded rather than in the index. The same step added an _Implemented_ column to that index, which raises the same question one level down: recording that an ADR has been built is a lifecycle fact, and ADR-0001's status vocabulary had nowhere to put it.

## Decision

We keep ADR-0001's practice and format and restate them here, so that this record stands alone. What is new is §Lifecycle.

### Format

Every significant architectural decision is recorded as an ADR in `docs/adr/`:

```
# ADR-NNNN: Title

- Status: proposed | accepted | deprecated | superseded by ADR-XXXX
- Date: YYYY-MM-DD

## Context
Why we need to decide; the forces at play.

## Decision
What we decided, in the imperative ("We use…", "We store…"). Include the concrete shape (folder trees, table sketches, code signatures) where it removes ambiguity.

## Consequences
What becomes easier, what becomes harder, follow-ups.

## Alternatives considered
What was rejected and why (short).
```

- One decision per file, named `NNNN-short-kebab-title.md`. Numbering is sequential and never reused.
- A "significant" decision is one that would be expensive to reverse, that constrains many modules, or that a new team member would otherwise have to reverse-engineer.
- ADRs are project-agnostic where possible.
- Code snippets are illustrative of shape and naming; the implementation is the source of truth for details.
- `docs/adr/README.md` is the index and is updated with each new ADR.

### Lifecycle

The status vocabulary is exactly `proposed`, `accepted`, `deprecated`, `superseded by ADR-XXXX`. There is no `implemented` status — see rule 4.

1. **An accepted ADR with code standing on it is immutable.** Only `Status` changes. A decision changes by writing a new ADR that supersedes it, and **the superseding ADR carries the whole decision**, not only the delta: a superseded record is out of force, and a reader must never have to assemble the current rule from two documents. That is why the format above is restated here rather than referenced.

2. **An accepted ADR with no code standing on it may be amended in place**, dated and labelled `**Amended YYYY-MM-DD (step N).**` at the point of change. The distinction is what the change means: supersession records a change of mind, amendment records a decision that was never finished. Before an implementation exists, essentially every gap found is the second kind, and minting a superseding ADR for each one buys a paper trail of states that never shipped.

   The condition is the code, not the calendar. A decision written ahead of the system it governs carries this exception until that system exists, which is why the rule is stated this way and not as "before 2026-08-18" — the next greenfield area of this blueprint gets the same latitude the API had.

3. **For ADRs 0001–0023 the window closed on 2026-08-18**, when the first deliverable shipped. Their amendment blocks are historical and are not to be extended. ADR-0022 closes with them although its two frontend apps are unbuilt: what that ADR decides — which frameworks, which ports, which versions — is implemented, and the part that is missing is an app's feature surface, which no ADR decided.

4. **Implementation is recorded in the index, not in the status.** `docs/adr/README.md` carries an _Implemented_ column naming the build step and the code that answers to each ADR. An ADR cannot know when it will be implemented, and editing twenty-three accepted files to tell them would be precisely what rule 1 forbids. The index is also where the question is asked, by a reader deciding whether a decision is theory or load-bearing.

5. **A downstream project bootstrapped from this blueprint supersedes; it never amends.** Its deviations are new ADRs in its own repository, referencing the blueprint ADR they replace. The blueprint's ADRs are upstream: editing one in place turns the next merge from the blueprint into a conflict, and loses the record of which decision was deliberately dropped.

## Consequences

- The rule that governed this repository's formative week is in the record rather than in a footnote, and the thirty `Amended 2026-08-18` blocks stop reading as violations of the ADR directly above them.
- Superseding costs more than amending, because the successor restates the whole decision. That cost is the mechanism, not a side effect: it makes changing a load-bearing decision deliberate, and it keeps every accepted ADR readable on its own.
- The index gains a standing duty. A new ADR's _Implemented_ cell is filled when the code lands, not when the ADR is accepted, so an ADR whose cell is empty is visibly still theory.
- ADR-0001 stays in the tree with `Status: superseded by ADR-0024`. It is this repository's first supersession, and the first exercise of the rule it records.
- Rule 2 will be argued about again the next time a large unimplemented area is designed up front. It should be: the honest reading is that it trades traceability for velocity, and it is only safe while nothing depends on the decision yet.

## Alternatives considered

- **Amend ADR-0001 in place to add the exception.** The fastest option, and self-refuting — it would use the exception to legislate the exception, one day after it expired.
- **A new ADR that adds to ADR-0001 without superseding it.** Leaves the status vocabulary in one file and the lifecycle in another, so the current rule is the union of two records. The repository already had one document doing that — the index — and the result is this ADR.
- **Leave the rule in `docs/adr/README.md`.** It worked for a week. But the index answers _which_ decision, not _what_ was decided; it carries no status, no date and no supersession trail, and nothing there is reviewed as a decision.
- **Retroactively convert the thirty amendments into superseding ADRs.** ADRs 0024–0053, most of them a paragraph, describing states of a repository that never shipped. Accurate, and unreadable.
