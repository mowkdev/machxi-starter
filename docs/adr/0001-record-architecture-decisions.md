# ADR-0001: Record architecture decisions

- Status: superseded by [ADR-0024](0024-adr-lifecycle.md)
- Date: 2026-08-17

## Context

`machxi-starter` is a blueprint repository. Its value is not the code alone but the reasoning behind it: teams that bootstrap a project from it need to know which choices are load-bearing and which are incidental, so they can extend the system without eroding its structure. Decisions that live only in commit messages or chat get lost.

## Decision

We record every significant architectural decision as an ADR in `docs/adr/`.

Format (MADR-lite):

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

Rules:

- Numbering is sequential and never reused.
- Accepted ADRs are not edited except to update `Status`. Change is expressed by a superseding ADR.
- A "significant" decision is one that would be expensive to reverse, that constrains many modules, or that a new team member would otherwise have to reverse-engineer.
- ADRs are project-agnostic where possible. Project-specific deviations made by a downstream project should be recorded as new ADRs in that project, referencing the blueprint ADR they supersede.
- `docs/adr/README.md` is the index and is updated with each new ADR.

## Consequences

- Onboarding and code review get a shared reference ("see ADR-0012" instead of re-arguing envelope shape).
- Some overhead per decision; kept low by the lightweight template.

## Alternatives considered

- Wiki / Notion pages: drift from the code, no review process.
- Full MADR with all optional sections: heavier than needed for a starter.
