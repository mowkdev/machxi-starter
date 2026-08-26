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
4. If superseding: change old ADR `Status` to `superseded by ADR-NNNN` (body untouched). **The successor states the delta** — what changes, why, and a line per section of the parent carried unchanged by reference ("§X, §Y of ADR-NNNN stand as written and are in force as part of this record"); whole restatement is permitted where the delta _is_ most of the record, never required (ADR-0050 §Lifecycle rule 1, replacing ADR-0024's carry-the-whole rule; 0047 and 0049, written under the old rule, stand as they are). Amending an accepted ADR in place is only allowed while no code stands on it — the condition is the code, not the calendar — or while its deliverable is `in progress` (ADR-0025 rule 2). Historical windows stand as ADR-0024 recorded them: for ADRs 0001–0023 the window closed 2026-08-18.
5. Update `docs/adr/README.md` index (right section, status); remove from "Planned" if fulfilled.
6. If it changes rules or scope: update `CLAUDE.md` non-negotiables, the current deliverable plan in `docs/plan/`, `.claude/skills/api-conventions/SKILL.md`.
7. Commit `docs(adr): ADR-NNNN <title>`.
