---
name: verify-deliverable
description: Stage 2 of the loop — refute a deliverable's ADR(s) against the frozen ADRs and the code, check the plan implements them with checkable steps, and stamp the plan "Verified for build" when nothing blocking remains, so deliverable-build may run on it. Use as "/verify-deliverable D8" after writing its ADRs by hand; a bare call means the first `planned` row.
---

# Verify deliverable `$ARGUMENTS` for build

The check between deciding (you, with Claude, in a session — `/new-adr`, the plan's build order) and building (`/run-deliverable`, unattended). The `deliverable-verify` workflow (`.claude/workflows/deliverable-verify.mjs`, by `scriptPath`) does the work; invoking it from here is the operator's opt-in. It reads; the only thing it writes is the stamp.

1. **Run it.** `Workflow({ scriptPath: "<repo>/.claude/workflows/deliverable-verify.mjs", args: { root: "<repo>", deliverable: "$ARGUMENTS" } })` (omit `deliverable` for a bare call; pass `stamp: false` for a report with no write).
2. **Report the verdict first**, then the issues ranked BLOCKER → MAJOR → MINOR, each with where, the problem and the fix, and — when it stamped — the stamp line and the commit. Relay the code facts that produced an issue in one line each.
3. **If not ready**, do not fix the ADRs or the plan yourself unasked: the fixes are decisions, and they belong in the session that wrote them. Offer to make each one, and re-run after the operator agrees — the stamp is only written on a clean run.
4. **If ready**, say what happens next: `/run-deliverable` will accept this deliverable once the previous one has shipped; `deliverable-build`'s preflight re-checks that nothing under `docs/adr/` or in the pending steps' ADR lists and done-whens changed since the stamped hash.

Never: edit an ADR, accept an ADR, open the deliverable, or build.
