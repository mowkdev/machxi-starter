---
name: plan-step
description: Execute one numbered step of a deliverable plan in docs/plan/ end to end — read the referenced ADRs, implement, test, update docs, and report against the definition of done. Use as "/plan-step D2.3"; a bare number means the deliverable currently in progress.
---

# Implement plan step `$ARGUMENTS`

Steps are identified `D<deliverable>.<step>` (ADR-0025 §Step identity). A bare number means the deliverable whose row says `in progress` in `docs/plan/README.md`.

1. Open `docs/plan/README.md` to resolve the deliverable, then open its plan file and locate the step. List its ADR references and read them **fully** (plus `/api-conventions`).
2. Restate the step's scope in 3–5 bullets and any assumptions. If something is undecided, ask before coding — a step that names a `proposed` ADR is gated and must not be started until that ADR is `accepted`.
3. Implement in small commits. Prefer the specialised subagents: `module-builder` for modules, `db-migrator` for schema, `test-engineer` for tests. Keep every rule in `CLAUDE.md`.
4. Green gate: `pnpm lint && pnpm check-types && pnpm test` (Postgres must be up — `test` includes the integration tier and is not cached, ADR-0026). Fix, don't skip.
5. Run `adr-reviewer` on the diff; also `security-reviewer` for anything touching `apps/api/src/core`, auth, or an admin endpoint. Address BLOCKER/MAJOR findings.
6. Update docs touched by the step (`.env.example`, the plan file's step notes, Postman via `/postman-sync`).
   - **ADR changes follow the deliverable's amendment window** (ADR-0025 rule 2): an ADR belonging to the deliverable in progress may be amended in place, labelled `**Amended YYYY-MM-DD (D<n>.<step>).**`; an ADR from a shipped deliverable may **not** — write a superseding ADR via `/new-adr` instead, and say so in the report rather than diverging silently.
7. Report: what was built (files), how it was verified, deviations from ADRs (with the amendment made or the superseding ADR proposed), and what the next step needs.
