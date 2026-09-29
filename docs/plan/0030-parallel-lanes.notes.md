# D30 — Parallel lanes: build notes

The per-step build record of [D30](0030-parallel-lanes.md) — what was built, the amendments, the review findings and their fates, the gate's output, and what is pending the operator — kept apart from the executable plan so a builder opens the plan and not the journal ([ADR-0068](../adr/0068-behaviour-specs-and-plan-notes.md) §2, the plan apart from its notes). `/step` appends here; `/ship` and the close-out read it.

## D30.1 — Accept ADR-0079; the ledger names lanes; the skills take the lane (2026-09-29)

**Built.** [ADR-0079](../adr/0079-parallel-lanes.md) accepted at the head; [ADR-0025](../adr/0025-deliverables.md) moved to `superseded by` for rule 5's delta — its third partial successor beside 0065 and 0068 — in its status line and supersession note only, the body untouched. The ADR index's 0025 and 0079 rows and the topic table's deliverables row say so. `scripts/rules-digest.mjs`: the process lines **Deliverables** and **The window** cite 0079 first and state the condition (no record in two open lanes, one schema lane, steps sequential within a lane), a new **Lanes** line carries §4–§5 (branch per deliverable, merge by the step, numbers reserved on `main`, a conflicted digest regenerated, the skills take the lane), and the digest header reads "which windows are open". `docs/rules/process.md` regenerated.

The ledger: §Rules' first bullet states the lane condition; §The window says a window belongs to _a_ deliverable in progress, gains a bullet fixing the entry shape, and carries **Open lanes:** above the running paragraph with one entry per lane in this form, which is what `D30.2`'s check reads:

`- **Lane [D<n>](<plan>.md)** — opened YYYY-MM-DD · records [NNNN](../adr/…), … · schema: yes|no`

D30's entry lists 0079 and its parent 0025, `schema: no`. `/step`, `/steps` and `/ship` take `D<n>`, check it against the window section, and refuse a bare call while more than one row is `in progress`; `/steps` passes the lane to `/step`; `/ship` removes only its own lane's entry. `/scope` writes the plan header's `- Records:` (every record written, superseded or amended, as linked references) and `- Schema: yes|no`, commits on `main`, and names the condition in its opening offer. D29's and D30's plan headers were brought to that form — D29's lists its six parents and holds [ADR-0067](../adr/0067-organizations.md) from opening, since `D29.4` moves it if the spike lands. `docs/README.md`, `CLAUDE.md` (kept under its 6 KB test: 6140 bytes) and the ledger's §Executing a step read for the plural.

**Amendments.** None to 0079. The plan's header gained a `Schema:` line.

**Review** (`adr-reviewer`, one pass): four findings.

1. D29's `Records:` named only 0078 with its parents as bare prose and omitted 0067, which `D29.4` moves — **fixed** (linked parents, 0067 held by the lane).
2. `/scope` fixed no form for the two header lines and the files disagreed (`schema: no` / "adds migrations" / "no migrations") — **fixed** (linked references; `Schema: yes|no`; both headers normalised).
3. Three singular window sentences (the digest header, the ledger's §Rules third bullet, §Executing a step) — **fixed**, digests regenerated.
4. The **Lanes** digest line states §4's branch convention a step before `/step` carries it (`D30.2`) — **logged**: the line matches an accepted record; D30 is the one lane and builds on `main`, and `D30.2` brings `/step` level with it.

**Gate.** `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` — green (exit 0) before the review fixes; re-run green after them (below). `node --test scripts/rules-digest.test.mjs` 10/10; `pnpm rules:digest` wrote nothing on a second run; `pnpm docs:check` clean; `pnpm test:scripts` 58/58.

**Pending the operator.** Nothing browser-side. The lane check itself is `D30.2`'s; until it lands, disjointness is read by hand.
