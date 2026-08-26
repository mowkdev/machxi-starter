---
name: ship
description: Close the in-progress deliverable — run its definition of done, sync records, move the ledger row to shipped, push/PR (ADR-0025 rule 4). Use as "/ship" when every step is ticked.
---

# Ship the in-progress deliverable

Runs the close-out. Every build step must be ticked in the plan file; if one is not, stop and say which.

1. **Definition of done, executed**: run every machine item of the plan's checklist verbatim — the full gate, `pnpm test:unit` twice (second run cached, the ADR-0026 property), `pnpm format:check`, `pnpm test:postman` where the deliverable touched endpoints, clean tree after.
2. **Operator items, named**: list every item only a human can check (browser walks, visual acceptance) and record each as _accepted by the operator_ or _pending_ — never fold them into "shipped" silently (the D3–D7 precedent).
3. **Records agree**: the deliverable's ADRs read `accepted` with amendments labelled; superseded parents read `superseded by`; the index's _Implemented_ cells name the steps; the plan's checkboxes are all ticked; the window documents (ledger, ADR index conventions, `docs/README.md`, `CLAUDE.md`, `.claude/rules/*`) say the window is shut — check them by reading, one pass.
4. **The ledger row** moves to `shipped YYYY-MM-DD` with a §How it closed note separating machine-verified from operator-accepted evidence. All three parts of ADR-0025 rule 4 happen together or not at all.
5. **Push / PR**: on `main`, commit by path and push; on a branch, push and open a PR with the checklist in the body.
6. Offer `/scope` for the next `planned` row — opening it stays the operator's decision.
