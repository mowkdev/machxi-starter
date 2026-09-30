# ADR-0050: ADR lifecycle v2 — delta supersessions, altitude, and verification by machines

- Status: superseded by [ADR-0065](0065-starter-lifecycle.md) (delta: rule 5 regains the reason ADR-0024 gave it, and a fork's deviation is a new record in the fork's own corpus) and [ADR-0082](0082-lanes-on-one-machine-and-one-main.md) (delta: a step ends green on the step check; the deterministic gate is the lane's stamp, run by CI on every push and locally once at ship)
- Date: 2026-08-26
- Supersedes: [ADR-0024](0024-adr-lifecycle.md)

> Written 2026-08-26 ahead of D8 opening, beside its siblings [0047](0047-ui-package-scope.md)–[0049](0049-admin-app-architecture.md); **D8 opened 2026-08-26** and this record was **accepted 2026-08-26 at the head of `D8.1`** with them, where [ADR-0024](0024-adr-lifecycle.md) moved to `superseded by ADR-0050`. It supersedes [ADR-0024](0024-adr-lifecycle.md) and carries it whole — deliberately the **last** supersession required to do so, because its own §Lifecycle changes that rule.
>
> **Superseded in part 2026-09-04 by [ADR-0065](0065-starter-lifecycle.md)**, accepted at the head of `D14.12`: a delta on rule 5 alone. Rule 5 keeps its decision — a downstream project supersedes and never amends — and regains the reason [ADR-0024](0024-adr-lifecycle.md) gave for it: an edit turns the next merge from the blueprint into a conflict and erases the record of which decision was deliberately dropped. Everything else here stands and is in force: the statuses, the delta rule, the altitude rule, and verification by the deterministic gate plus one bounded review pass per step.
>
> **Superseded in part 2026-09-30 by [ADR-0082](0082-lanes-on-one-machine-and-one-main.md)**, at `D34.2`, the step that builds its §2: a delta on §Verification item 1 alone. A step no longer ends on the deterministic gate but on the step check `CLAUDE.md` §Commands defines beside it (`pnpm step:check`: the fast loop, the integration files the change reaches, `size` when an SPA is reached, `format:check`). The gate stays the stamp, and it is the lane's: run by CI on every push to the lane's pull request and on the machine once, at ship. A plan is still buildable when its done-whens are commands and test names. **Everything else here stands and is in force**, together with 0065: the one bounded review pass per step, the spike, and the pre-build reading pass.

## Context

Between 2026-08-22 and 2026-08-26, seventeen multi-agent verification rounds were run against D8's three ADRs and plan before any code existed. Each round cost on the order of a million tokens; the blocking-finding count oscillated instead of converging; and the fix passes injected new defects at roughly the rate they removed old ones. Post-mortem, three causes, all structural:

1. **A zero-finding gate over adversarial LLM review does not terminate.** Reviewers at maximum scrutiny always find something in ~800 lines of prose; every fix creates new checkable surface.
2. **The documents crossed the altitude line.** Plan done-whens specified literal class strings and file enumerations. At that resolution a plan is code — written in English, validated by prose refutation, with no compiler. The genuine defects those rounds caught (a CSS chain, an inert flex gap) are the kind a builder meets in minutes at a real browser.
3. **ADR-0024 rule 1 — a superseding ADR carries the whole decision — multiplied text.** 0047 restates all of 0031 and 0049 all of 0032; every restated sentence was new refutable surface, almost all of it duplicated.

The decisions themselves were stable throughout. What churned was volunteered detail. This record keeps what ADR-0024 got right and changes the three rules that produced the churn.

## Decision

### Format (carried from ADR-0024, unchanged)

Every significant architectural decision is recorded as an ADR in `docs/adr/`:

```
# ADR-NNNN: Title

- Status: proposed | accepted | deprecated | superseded by ADR-XXXX
- Date: YYYY-MM-DD

## Context / ## Decision / ## Consequences / ## Alternatives considered
```

One decision per file, `NNNN-short-kebab-title.md`, numbering sequential and never reused. A "significant" decision is one that would be expensive to reverse, constrains many modules, or a newcomer would otherwise reverse-engineer. Snippets are illustrative of shape and naming; the implementation is the source of truth for details. `docs/adr/README.md` is the index and is updated with each new ADR.

### Altitude — what an ADR may state (new)

An ADR records **decisions and the constraints that motivate them**. It does not volunteer machine-checkable minutiae:

- **No counts, no exhaustive enumerations, no universal negatives** ("thirteen call sites", "the search returns seven lines", "no `x:` literal type-checks"). These go stale, they are miscounted at writing time more often than not, and each one is a hostage a reviewer must check. Where the fact matters, state it as a **predicate** ("no comment may claim X lives at Y") and let the step that enforces it find the current set.
- **Machine-checkable facts belong in tests and lint rules, not prose.** If a plan's done-when wants to pin a class, an attribute or a DOM relation, the deliverable adds the assertion and the done-when names the test. A sentence that a compiler could check is a sentence in the wrong language.
- **Target length ~80 lines** for a new ADR. Length is a review cost and a defect surface; a record that needs 250 lines is usually carrying implementation.

### Lifecycle

The status vocabulary is exactly `proposed`, `accepted`, `deprecated`, `superseded by ADR-XXXX`.

1. **An accepted ADR with code standing on it is immutable**; only `Status` changes. A decision changes by a superseding ADR — and **the successor states the delta**: what changes, why, and a line per section of the parent that is carried unchanged by reference ("§X, §Y of ADR-NNNN stand as written and are in force as part of this record"). A reader gets the current rule from the successor plus the named sections of the parent, which stays in the tree unedited. Whole-restatement is permitted where the delta *is* most of the record, never required. *(Replaces ADR-0024 rule 1; ADRs 0047 and 0049, written under the old rule, stand as they are.)*
2. **An accepted ADR with no code standing on it may be amended in place**, dated and labelled `**Amended YYYY-MM-DD (step N).**` — carried unchanged, including its condition: the code, not the calendar.
3. **Historical windows stand as ADR-0024 recorded them**: ADRs 0001–0023 closed 2026-08-18; amendment blocks in closed records are not extended.
4. **Implementation is recorded in the index**, in the _Implemented_ column, when the code lands — never as a status.
5. **A downstream project bootstrapped from this blueprint supersedes; it never amends** — its deviations are new ADRs in its own repository referencing the blueprint record they replace.

### Verification (new) — machines gate, review is one pass, spikes answer mechanics

The three-stage decide → verify → build pipeline and its multi-agent refutation workflows are **retired**. Verification of a deliverable is:

1. **The deterministic gate**: `pnpm lint && pnpm check-types && pnpm test` (plus `i18n:check` and `format:check` where the plan names them). This is the stamp. A plan is buildable when its steps' done-whens are commands and test names that this gate can run.
2. **One bounded review pass per step, on the diff**: after a step goes green, a single reviewer reads the diff for correctness — at most a handful of findings, confirmed ones fixed, no re-review round, no zero-finding requirement. Review grounded by a compiling diff and green tests; never review of prose against prose.
3. **A spike, when a mechanism is uncertain**: a timeboxed throwaway in a worktree answers "does this CSS/typing/API shape actually work" — never a debate between reviewers. The spike's answer lands in the plan as one sentence; the spike is deleted.

Pre-build document review is a **single reading pass by one reviewer at most** — top findings that would make a builder write the wrong code, fixed once — and is optional for a plan whose done-whens are already commands.

## Consequences

- Supersession stops multiplying text; the duplication that fed seventeen refuter rounds cannot recur by construction.
- ADRs get shorter and stop carrying facts that rot; plans point at tests instead of describing DOM in prose.
- The expensive failure mode moves where it is cheap: a wrong mechanical guess is now caught by a compiler or a spike in minutes, not by a million-token refutation round.
- The cost accepted knowingly: less pre-build assurance in prose. The amendment window (rule 2 of [ADR-0025](0025-deliverables.md), unchanged) is the shock absorber — a record corrected by the step that hits reality is the system working.
- ADR-0024 stays in the tree, `superseded by ADR-0050`, its history intact.

## Alternatives considered

- **Keep the refutation pipeline, tuned.** Two recalibrations were tried (severity split, dedup instruction); blocking counts fell but the fixer kept injecting defects into the prose the refuters then found. The defect factory is the volunteered detail, not the reviewers.
- **Zero-finding gate on a smaller reviewer pool.** Any zero-finding gate over open-ended LLM review is non-terminating on a document this cross-referential; the pool size only changes the period.
- **Retire ADRs entirely, decisions in plan files.** Loses the index, the status trail and the decided-vs-built distinction, which earned their keep across D1–D7. The problem was never the records; it was their altitude and their duplication.
- **Amend ADR-0024 in place.** Frozen since D1 shipped; the mechanism it prescribes for changing it is the one used here.
