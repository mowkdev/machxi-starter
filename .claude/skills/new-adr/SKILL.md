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
4. If superseding: change old ADR `Status` to `superseded by ADR-NNNN` (body untouched); explain delta in the new one. Always supersede: the pre-first-deliverable window in which accepted ADRs could be amended in place closed on 2026-08-18, when the first deliverable shipped (see the conventions in `docs/adr/README.md`).
5. Update `docs/adr/README.md` index (right section, status); remove from "Planned" if fulfilled.
6. If it changes rules or scope: update `CLAUDE.md` non-negotiables, `docs/implementation-plan.md`, `.claude/skills/api-conventions/SKILL.md`.
7. Commit `docs(adr): ADR-NNNN <title>`.
