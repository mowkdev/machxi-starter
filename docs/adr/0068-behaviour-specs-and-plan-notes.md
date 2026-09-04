# ADR-0068: Behaviour specs, and the plan apart from its notes (supersedes ADR-0065 and ADR-0025 in part — deltas)

- Status: accepted
- Date: 2026-09-04
- Supersedes: [ADR-0065](0065-starter-lifecycle.md) (delta: §3's carried documents gain `docs/specs/`, which is edited in place; §5's governing documents gain a behaviour spec per capability and the plan file splits from its build notes — every other decision stands); [ADR-0025](0025-deliverables.md) (delta: the plan file's shape — the executable plan in one file, its build notes in a sibling; every decision 0025 makes about deliverables, windows and acceptance stands — its second partial successor, the 0048 shape)

> Written 2026-09-04 at the operator's decision, after an assessment of OpenSpec against this repository's own documents, and **accepted the same day at the head of `D15.7`** — a process step riding in the open deliverable (the `D13.1` precedent), joining the window at the step that needs it (the `D12.12`/0056 precedent). Both parents moved at that head. Amendable in place, labelled, while D15 is `in progress` ([the ledger](../plan/README.md#the-window)).

## Context

[ADR-0065](0065-starter-lifecycle.md) §5 took two ideas from OpenSpec when D14 was scoped — a current-rules digest per area, regenerated at ship — and declined the framework, for reasons that still hold: its archive step edits a capability's spec in place on both sides of a fork, which is the merge conflict §1 of that record exists to prevent for decisions, and it archives the reasoning that this corpus keeps as a linked graph. What the assessment found is that two of its remaining ideas answer two costs this repository has measured.

**There is no document that says what the API does.** "What does `/user/auth/refresh` answer to a replayed token?" is answered today by a thousand-line service, an integration file, a Postman folder and a digest line that states the _rule_. The records say why; the digests say what is in force; the tests prove it; nothing states the behaviour a client can observe, in a form a client's author can read.

**The document a builder opens is the wrong size.** `D14.12` measured the digests against the ADR chain: the context a step pulls in fell by about a third, and the total billed was a wash because it is dominated by re-reading the cached prefix once per turn — so what a document _costs_ is what a step opens, and how many turns it takes. `/step` opens "the step's entry in the deliverable's plan file", and that file carries every earlier step's build narrative: the D13 plan is some thirty thousand tokens, the D14 plan some forty-five thousand, the ledger nearly forty. The narrative is the journal 0065 §3 keeps deliberately; it is in the wrong file.

## Decision

Two additions to the governing documents, both deltas on [ADR-0065](0065-starter-lifecycle.md) §5, and one on the plan file's shape.

### 1. A behaviour spec per capability

`docs/specs/<capability>.md` states the **current** behaviour of one capability as a client observes it on the wire. Its shape is fixed and checked:

```
## Requirement: <name>
<One or two sentences in the indicative: what the API answers, what it refuses.>
Records: [ADR-NNNN](../adr/NNNN-….md) …          ← at least one, in force
Proved by: `apps/api/test/….int.test.ts` …          ← at least one, existing

### Scenario: <name>
- **WHEN** <the request, or the state that precedes it>
- **THEN** <the observable answer: status, code, body, header, side effect>
```

A spec is **current truth, edited in place** by the step that changes the behaviour, in the same diff as the code and the test that proves it. It has no history and no status; git is its history. It is not a decision — the record says why — and not a rule — the digest says what is in force — and not a test — the test proves it. Its altitude is the wire: a requirement is something a client can observe, and an internal that a client cannot stays out.

`pnpm docs:check` enforces the shape: every requirement carries a `Records:` line whose records exist and a `Proved by:` line whose files exist, and at least one scenario with a **WHEN** and a **THEN**. A test that is deleted reddens every spec that cited it, which is the cheap form of "a scenario without a test is a claim". The specs travel into forks, so the inherited-document rules apply to them as to `.claude/**`: no step numbers, no dates, no bare ranges.

The API's HTTP behaviour is covered first, because it is the surface with a contract. An SPA spec arrives when a step names one; a screen's behaviour is proved by its own suites and is not made to fit a WHEN/THEN it would strain against.

### 2. The plan apart from its notes

`docs/plan/<nnnn>-<slug>.md` holds the **executable plan**: the goal, the constraints, the decisions taken at scoping, the steps with their records and their done-whens, the definition of done, and what is out. `docs/plan/<nnnn>-<slug>.notes.md` holds the **build notes**: per step, what was built, the amendments, the review findings and their fates, the gate's output, and what is pending the operator — appended by `/step`, read by `/ship` and by the close-out. The step's checkbox stays in the plan.

The split applies from this record's acceptance forward. Shipped plans stay as they are — they are the journal — and the deliverable in progress moves nothing already written; its notes file begins with the step that accepts this record.

### 3. What travels into a fork

`docs/specs/` is carried, and — unlike a record — **edited in place on both sides**. It conflicts on a merge from `starter/main` exactly where `apps/` does, because it documents the code and diverges where the code diverges. The reason [ADR-0065](0065-starter-lifecycle.md) §1 forbids editing an inherited record — the edit erases which decision was deliberately dropped — does not reach a document that decides nothing. [`docs/forking.md`](../forking.md)'s table gains the row. Notes files are journal, like the plans beside them, and `docs/plan/**` is already `merge=ours`.

### 4. What the skills do

`/scope` writes the plan and an empty notes file beside it, and may name a spec scenario in a done-when. `/step` orients on the plan's entry and the capability's spec, updates the spec with the behaviour it changes, and appends its note. `/ship` sweeps `docs/specs/**` with the rest and runs the check.

## Consequences

- What a builder opens per step becomes the plan proper plus one spec — kilobytes, not the journal. Measured at the next `/ship` beside `D14.12`'s numbers rather than asserted here.
- A behaviour question has a document, and the document names the test that keeps it true.
- The specs are one more thing to keep current. The mitigations are the rule that the spec changes in the same step as the behaviour, the check in the definition of done, and the `Proved by:` line: a spec cannot silently outlive its test.
- No dependency, no CLI, no telemetry: one script this repository already owns grew a second scan.
- OpenSpec stays not adopted. What it would still add — a lifecycle simpler than acceptance-at-the-head, portability to other agents — is bought by giving up the reasoning graph and the fork model, and that trade is recorded here as declined rather than left to be re-argued.

## Alternatives considered

- **Adopting OpenSpec wholesale.** Its `specs/` are this record's §1 and its `tasks.md` is §2's plan; its archive edits specs on both sides of a fork and files the reasoning by date. The two ideas are taken; the framework is not.
- **Generating scenarios from the tests.** A test's name is not a sentence a client's author can read, and a generator would need a naming convention the suites do not have and should not be bent to.
- **Behaviour inside the records.** A record decides and is frozen when its deliverable ships; behaviour changes by amendment and supersession, which is the chain a reader of "what does it do today" should never have to walk.
- **Deleting the build notes instead of moving them.** They are the close-out's evidence and the journal 0065 §3 keeps on purpose; the defect was their location, not their existence.
