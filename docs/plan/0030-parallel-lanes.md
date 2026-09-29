# D30 — Parallel lanes

- Status: **planned** — **scoped in full 2026-09-29 by `/scope`**, on the operator's question the same day, with D22 in progress and D29 scoped (ledger §How D30 was scoped). Not opened. D22 shipped 2026-09-29, so the one condition of ADR-0025 rule 5 (the rule this deliverable supersedes, and which binds it until it ships) is met; opening is the operator's decision.
- Records: [ADR-0079](../adr/0079-parallel-lanes.md) (more than one deliverable in progress when their records are disjoint; a delta on ADR-0025 rule 5 as carried by ADR-0065 and ADR-0068) — written `proposed` at scoping, accepted at the head of `D30.1`.
- Ledger: [`docs/plan/README.md`](README.md)
- Notes: [`0030-parallel-lanes.notes.md`](0030-parallel-lanes.notes.md)

## Goal

Let deliverables whose records never meet be built at the same time, in separate sessions, without a second mutable copy of any record. ADR-0025 rule 5 gives way to a disjointness condition a test checks, the ledger's window section names every open lane, and the process skills take the lane as their argument. It runs after D22 and before D29, so that D29 opens as the first lane beside whatever comes next, and it lands before the fork so that every project inherits the rule with the records.

## Constraints

- Window and supersession state is written in the ledger's window section and nowhere else; every document links to it (ADR-0065 §5, as carried).
- The digests are generated: a rule line in `scripts/rules-digest.mjs` names its record, and `pnpm rules:digest` writes them; the generator refuses an accepted record no line cites (ADR-0065 §5 as carried by ADR-0074).
- `.claude/**` carries no step number, no date and no bare record range, and a window statement links to the ledger; `pnpm docs:check` enforces it (ADR-0065 §5).
- A superseding record states its delta and the parent's status line names it; the parent's body is untouched (ADR-0050 rule 1 as carried by ADR-0065).
- D30 opens alone, under the rule it replaces: D22 has shipped before it opens, and D29 does not open until D30 ships (ADR-0025 rule 5 as it stands today).
- The gate as `CLAUDE.md` §Commands defines it, at every step.

## Decisions taken at scoping (2026-09-29)

Recommended in the sitting that asked whether two deliverables could be built at once; the operator confirms them when D30 opens.

- **Disjoint records, not disjoint files.** The condition on two lanes is that no record — written, superseded or amended — belongs to both. Files are git's problem.
- **One schema owner.** At most one open lane adds migrations; the journal is one file.
- **Merge to `main` by the step.** A lane merges `main` in before its gate and merges out when green; `/ship` runs on `main`.
- **The skills take the lane.** `/step`, `/steps` and `/ship` take `D<n>` while more than one row is in progress and refuse a bare call then.
- **Recorded, not asked:** steps within a lane stay sequential; no record is shared by agreement; D30 precedes D29 in the build order, and D29 stays the last starter deliverable before the fork.

## Steps

Each step: implement, gate green, one bounded diff review, commit (ADR-0050). ADRs listed are what the builder reads first.

- [ ] **1. Accept ADR-0079; the ledger names lanes; the skills take the lane.** Accept 0079 at the head, where [ADR-0025](../adr/0025-deliverables.md)'s status line gains its delta (the index row, the topic table and the ledger's rules and window sections say so), and write its digest lines: the process lines on deliverables and the window cite 0079 and state the condition. The ledger's window section is restructured to one entry per open lane — deliverable, opening date, records — above the running paragraph; the shape of an entry is the builder's, and it is what `D30.2`'s check reads. `/step`, `/steps` and `/ship` take `D<n>` while more than one row is in progress and refuse a bare call then; `/scope` writes a plan's records where the check can read them and its opening offer names the condition; `docs/README.md` and `CLAUDE.md` read for the plural and keep linking to the window section.
      **ADRs:** 0079, 0025 as carried by 0065 and 0068, 0065 §5, 0074 (the digest generator).
      **Done when:** `scripts/rules-digest.test.mjs` green; `pnpm rules:digest` writes nothing on a second run; `pnpm docs:check` clean; `pnpm test:scripts` green; `pnpm lint` green.
- [ ] **2. The lane check, and the branch convention.** `scripts/docs-hygiene.mjs` reads the ledger's window section into the open lanes and their records and refuses two lanes naming one record or two lanes owning the schema; `scripts/docs-hygiene.test.mjs` proves it on fixtures the way it proves the spec rules. `/step` gains the branch convention of ADR-0079 §4 — a branch named for the deliverable, `main` merged in before the gate, the step merged to `main` when green, a step not closed while `main` does not carry it — and `/ship` says it runs on `main`. `docs/forking.md` says the rule travels with the records and the ledger does not.
      **ADRs:** 0079 §1, §3 and §4; 0065 §1 and §5; 0068 §2.
      **Done when:** `scripts/docs-hygiene.test.mjs` cases "two open lanes never share a record", "a second lane on the schema is refused" and "one open lane reads as before" green; `pnpm docs:check` clean on the committed tree; `pnpm test:scripts` green; `pnpm lint` green.
- [ ] **3. Close-out.** `.claude/README.md` says how lanes run and that `/steps` stays in its lane; the digests regenerated; then the definition of done.
      **ADRs:** 0079, 0065 as carried.
      **Done when:** the definition of done below, every item.

## Definition of done

Run at `D30.3` and again by `/ship` on the committed tree.

1. The gate green, every task cold: `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check`.
2. `pnpm test:unit` twice, the second `FULL TURBO`.
3. `pnpm rules:digest` writes nothing on a second run; `pnpm docs:check` clean; `pnpm test:scripts` green.
4. A clean tree afterwards.

## Not in D30

Opening D29 — the first lane opened under the rule, and its narrative goes in the ledger's §How D29 opened; parallel steps within a lane; a shared migration journal across lanes (ADR-0079 §3); D26's restatement; D16.
