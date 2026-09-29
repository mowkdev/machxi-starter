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

## D30.2 — The lane check, and the branch convention (2026-09-29)

**Built.** `scripts/docs-hygiene.mjs` gains `parseLanes`, `checkLanes` and `scanLanes`, and `pnpm docs:check` runs them over the ledger (`open lanes: disjoint (N open)`). The parser reads the list under `**Open lanes:**` in `## The window` in `D30.1`'s entry shape, and it reads the table's `**in progress**` rows. The check refuses:

- `lane-shared-record`: two lanes naming one record.
- `lane-second-schema`: a second `schema: yes`.
- `lane-malformed`: an entry that does not parse, a records field that is not wholly `[NNNN](../adr/NNNN-….md)` links with each label agreeing with its file, or an indented line inside the list.
- `lane-duplicate`: two entries for one deliverable.
- `lane-missing` / `lane-not-open`: an `in progress` row with no entry, or an entry with no `in progress` row. This means a misspelt list heading is a failure rather than zero lanes.

A ledger with nothing in progress and no list (a fresh fork's) reads clean, and so does one with no ledger at all. `scripts/docs-hygiene.test.mjs` has the three named cases, "two open lanes never share a record", "a second lane on the schema is refused" and "one open lane reads as before", plus one case per other rule and a case that reads the committed ledger.

`/step` gains §4's branch convention:

- It builds on `lane/D<n>` while another lane is open.
- It merges `main` in before the gate.
- It merges the step to `main` when green.
- A step is not closed while `main` does not carry it.
- A conflicted digest is regenerated.

`/ship` says it runs on `main`, and its PR path is gone. `docs/forking.md` says the lane rule travels with the records while the lanes, being journal, do not. The ledger's window-section bullet names the check.

**Amendments.** ADR-0079 §4, **Amended 2026-09-29 (D30.2)**: a lane that is the only one open may build on `main` itself, since both merges are empty. It cuts its branch, `lane/D<n>`, when a second lane opens. This is how D30 itself is built, and §4 as written would have put this step off-record. §Consequences' "every step ends with a merge" bullet was amended to match, under the same label. The **Lanes** digest line in `scripts/rules-digest.mjs` says the same, and `docs/rules/process.md` was regenerated.

**Review** (`adr-reviewer`, one pass): five findings, all fixed.

1. MAJOR: a record written without a link was skipped, so a shared record could hide. **Fixed**: the records field must be links only, with labels agreeing with their files.
2. MAJOR: a misspelt `**Open lanes:**` heading read as zero lanes and passed. **Fixed**: the table's `in progress` rows are cross-checked against the entries (`lane-missing`, `lane-not-open`).
3. MAJOR: an indented line ended the list, and later lanes were dropped. **Fixed**: an indented line is `lane-malformed` and the list continues.
4. MINOR: ADR-0079 §Consequences contradicted the §4 amendment. **Fixed**, labelled.
5. MINOR: two entries for one deliverable were accepted. **Fixed** (`lane-duplicate`).

**Gate.** `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` — green (exit 0) before the review fixes and again after them; `pnpm test:scripts` 68/68. `node --test scripts/docs-hygiene.test.mjs` 44/44. `pnpm rules:digest` wrote nothing on a second run. `pnpm docs:check` is clean.

**Pending the operator.** Nothing browser-side.

## D30.3 — Close-out (2026-09-29)

**Built.** `.claude/README.md` gains a **Lanes** bullet under the process skills: the lane condition (no record in two open lanes, one schema lane) with a link to the ledger's window section rather than a restatement, `pnpm docs:check` as the check, the skills taking `D<n>` and refusing a bare call while more than one lane is open, the branch convention of ADR-0079 §4 as amended (`lane/D<n>`, or `main` while alone; `main` merged in before each gate; each green step merged to `main`; `/ship` on `main`), and `/steps` staying in its lane. The digests were regenerated: `pnpm rules:digest` wrote 0 of 3, as `D30.1` and `D30.2` had left them current.

**Amendments.** None.

**Review** (`adr-reviewer`, one pass): one finding.

1. MINOR: "`/steps` … never starts, touches or ships another" implied it may open or ship its own lane, which the skill never does. **Fixed**: "never opens or ships a deliverable, and never touches another".

**The definition of done, item by item.** Verified by running, by the step's builder.

1. **Green.** The gate, every task cold (`--force`): `lint` 22/22, `check-types` 17/17, `test` 17/17 (the integration tier against the test database), `size` 4/4, all 0 cached; `format:check` clean. After the review's one-word fix and this note, `lint`, `format:check` and `docs:check` were re-run: see the commit message.
2. **Green, on the second attempt.** The first cold `pnpm test:unit --force` failed in `customer` alone: two cases timed out at 30 s (`impersonation-exchange.test.tsx` "leaves nothing unaccented on the state a person sits on", `pseudo-notice.test.tsx` "renders into the shell's banner region when the channel says so"); 15/17 others passed. `customer` alone, cold, passed 281/281, and a second full cold run passed 17/17, followed by a warm run at 17/17 cached, `FULL TURBO`. This step changed no source. The cause is inferred, not proved: load in the two-at-a-time unit tier beside the operator's running stack, the same family as D22.4's worker-start timeouts. **Logged, not fixed**: a flake in the customer jsdom tier under load.
3. **Green.** `pnpm rules:digest` wrote 0 of 3 on both runs; `pnpm docs:check` clean (`open lanes: disjoint (1 open)`); `pnpm test:scripts` 68/68.
4. **Green.** `git status` clean after the commit.

**Pending the operator.** Nothing browser-side. `/ship` is not run here. The customer unit-tier timeout above is the operator's to route.
