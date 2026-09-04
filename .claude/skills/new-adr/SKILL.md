---
name: new-adr
description: Write a new or superseding Architecture Decision Record in docs/adr following the house template, and update the index, plan and CLAUDE.md. Use when a decision is made, when code needs to diverge from an ADR, or to record a decision from discussion.
---

# New ADR — `$ARGUMENTS` (title or topic)

1. Read `docs/adr/README.md` (index + conventions), `docs/adr/template.md`, and every ADR the topic touches. Next number = highest + 1.
2. Confirm the decision and rationale with the user if not explicit — never invent a decision. Ask: what forces? what did we reject? what does it constrain later?
3. Write `docs/adr/NNNN-kebab-title.md`:
   - Header: `# ADR-NNNN: Title`, `- Status: accepted` (or `proposed`), `- Date: YYYY-MM-DD`.
   - **Context** (forces, why now), **Decision** (imperative; concrete shapes — trees, table sketches, function signatures in functional style per ADR-0009), **Consequences** (easier/harder/follow-ups), **Alternatives considered** (short, with why rejected).
   - Cross-reference `ADR-XXXX`. Keep project-agnostic. No secrets.
   - **Altitude** (ADR-0050): record decisions and the constraints that motivate them. **No counts, no exhaustive enumerations, no universal negatives** — they go stale, they are miscounted more often than not, and each is a hostage a reviewer must check. Where the fact matters, state a predicate and let the step that enforces it find the current set; where a class, an attribute or a DOM relation must be pinned, the deliverable adds the assertion and the plan names the test. **Target ~80 lines.**
4. If superseding: change the parent's `Status` to `superseded by ADR-NNNN`, with the delta named in the same line, and leave its body untouched. **The successor states the delta** — what changes, why, and a line per section of the parent carried unchanged by reference ("§X, §Y of ADR-NNNN stand as written and are in force as part of this record"); whole restatement is permitted where the delta _is_ most of the record, and never required (ADR-0050, the ADR lifecycle, as carried by ADR-0065, the starter lifecycle). Amending an accepted record in place is allowed only while its deliverable is in progress — see [the window](../../../docs/plan/README.md#the-window), which is the one place that says which one that is. A record inherited from the starter is never edited in a fork: it is superseded, because an edit turns the next merge into a conflict and erases which decision was deliberately dropped (ADR-0065, the starter lifecycle).
5. Update `docs/adr/README.md` index (right section, status); remove from "Planned" if fulfilled.
6. If it changes rules or scope: update `CLAUDE.md` non-negotiables, the current deliverable plan in `docs/plan/`, `.claude/skills/api-conventions/SKILL.md`.
7. Commit `docs(adr): ADR-NNNN <title>`.
