---
name: ship
description: Close an in-progress deliverable — run its definition of done, regenerate the digests, sync the records, tag, changelog, move the ledger row to shipped, push — on `main`. Use as "/ship" when one deliverable is in progress and every step is ticked, or "/ship D<n>" to name the lane when more than one is.
---

# Ship deliverable $ARGUMENTS

Runs the close-out of one lane. More than one deliverable may be in progress, each a lane with disjoint records ([ADR-0079](../../../docs/adr/0079-parallel-lanes.md), parallel lanes; the open lanes are in [the ledger's window section](../../../docs/plan/README.md#the-window)). An argument `D<n>` names the lane and must be one the window section lists; a bare call ships the one `in progress` row and **is refused when more than one row is `in progress`** — ask which lane. **`/ship` runs on `main`** (ADR-0079 §4, a lane merges to `main` by the step): every step of a lane built on its own branch has already merged there, so check out `main`, confirm it carries the lane's last step, and ship from it — never from `lane/D<n>`. Every build step must be ticked in the lane's plan file; if one is not, stop and say which. The evidence per step is in the deliverable's `.notes.md` beside the plan (ADR-0068, the plan apart from its notes) — read it here, once.

1. **Definition of done, executed**: run every machine item of the plan's checklist verbatim — the gate (`CLAUDE.md` §Commands), `pnpm test:unit` twice with the second run fully cached, `pnpm test:postman` where the deliverable touched endpoints, `pnpm test:scripts`, and a clean tree afterwards.
2. **Operator items, named**: list every item only a human can check (browser walks, visual acceptance, a deployment) and record each as _accepted by the operator_ or _pending_ — never fold one into "shipped" silently.
3. **Regenerate the derived documents**: `pnpm rules:digest`, then `pnpm docs:check`. The digests are generated, never hand-edited; the hygiene check is what keeps the inherited documents free of this repository's step numbers and dates, and what refuses a behaviour spec whose record or test no longer exists (ADR-0068, behaviour specs).
4. **Records agree**: the deliverable's records read `accepted` with their amendments labelled; every superseded parent reads `superseded by` with its delta stated; the ADR index's topic table names the record now in force and its _Implemented_ cells name the steps; the plan's checkboxes are all ticked.
5. **The sweep**: window and supersession state lives in one section, [the ledger](../../../docs/plan/README.md#the-window) — update it there, removing the lane's entry and leaving every other lane's untouched, then read (do not restate) everything that links to it: `.claude/**`, `CLAUDE.md`, `README.md`, `docs/README.md`, `docs/specs/**` and the ADR index. A document that states the status instead of linking to it is the defect this list exists to catch.
6. **The ledger row** moves to `shipped YYYY-MM-DD` with a §How it closed note separating machine-verified from operator-accepted evidence.
7. **Tag and changelog**: an annotated tag `starter-D<n>` on the shipping commit, and one entry in `docs/CHANGELOG.md` written from the plan's goal line — number, name, ship date, goal. One entry per deliverable; not per commit, and not semver. A fork reads the tag to say which starter it is on.
8. **Push**: on `main`, commit by path, push, and push the tag (`git push origin starter-D<n>`). A lane's branch has nothing left to merge once `main` carries its last step; delete it.
9. Offer `/scope` for the next `planned` row — opening it stays the operator's decision.

Steps 4 to 7 happen together or the deliverable is not closed.
