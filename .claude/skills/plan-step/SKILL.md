---
name: plan-step
description: Execute one numbered step of docs/implementation-plan.md end to end — read the referenced ADRs, implement, test, update docs, and report against the definition of done. Use as "/plan-step 6" while building the first deliverable.
---

# Implement plan step `$ARGUMENTS`

1. Open `docs/implementation-plan.md`, locate step `$ARGUMENTS`, list its ADR references and read them fully (plus `/api-conventions`).
2. Restate the step's scope in 3–5 bullets and any assumptions; if something is undecided, ask before coding.
3. Implement in small commits. Prefer the specialised subagents: `module-builder` for modules, `db-migrator` for schema, `test-engineer` for tests. Keep every rule in `CLAUDE.md`.
4. Green gate: `pnpm lint && pnpm check-types && pnpm test` (+ `test:int` when DB involved). Fix, don't skip.
5. Run `adr-reviewer` on the diff; for steps 7–8 also `security-reviewer`. Address BLOCKER/MAJOR findings.
6. Update docs touched by the step (`.env.example`, ADR amendments, `docs/implementation-plan.md` checkboxes/notes, Postman via `/postman-sync`).
7. Report: what was built (files), how it was verified, deviations from ADRs (with the ADR amendment made or proposed), and what the next step needs.
