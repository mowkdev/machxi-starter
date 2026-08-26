---
name: scope
description: Scope a deliverable into a one-page buildable plan — goal, constraints, ADR deltas, and steps whose done-whens are commands and test names (ADR-0050). Use as "/scope D9"; a bare call means the first `planned` ledger row.
---

# Scope deliverable $ARGUMENTS

Turn a deliverable's scope document into a **one-page plan** the `/step` loop can execute. This is a conversation with the operator, not a fan-out: read, propose, ask only what the code cannot answer, write.

1. **Read**: the deliverable's file in `docs/plan/` (via the ledger `docs/plan/README.md`), the ADRs it names, and the code it touches. Verify every claim you are about to rely on by opening the file — never assert a count, an enumeration or a universal negative you have not just read (ADR-0050 §Altitude).
2. **Identify the real decisions** — the ones that are expensive to reverse or that steps would otherwise guess at. Ask the operator with recommended options. Everything else is the builder's call and is not written down.
3. **Spike the uncertain mechanics.** If a decision hangs on "would this actually work" (CSS chains, typing channels, API shapes), propose a timeboxed throwaway spike in a worktree instead of deciding in prose. The spike's answer becomes one sentence in the plan.
4. **Write the plan** into the deliverable's file:
   - Goal (2–3 sentences), constraints (bullet list, each citing its ADR).
   - New ADRs only for genuine decisions: ~80 lines, delta supersessions per ADR-0050, `proposed`, accepted at the head of the step that builds on them.
   - Steps as a checklist, each PR-sized, each with **ADRs:** (what to read) and **Done when:** — _commands and test names only_: `pnpm check` green, a named test asserting X, a named browser-walk item. A done-when that is an English claim about the DOM is at the wrong altitude; move it into a test the step writes.
5. **Optional single review pass**: at the operator's request, one `adr-reviewer` reading for "what would make a builder write the wrong code" — top findings, fixed once, no re-review round. Never loop.
6. Commit by explicit path. Opening (the ledger row to `in progress`) is the operator's decision — offer it, never assume it.

Never: multi-round refutation, zero-finding gates, counts or file enumerations in prose, done-whens a machine cannot run.
