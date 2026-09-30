# D31 — Interface polish

- Status: **in progress** — **scoped in full 2026-09-29 by `/scope`**, on the operator's list of the same day, with D30 in progress (ledger §How D31 was scoped). **Opened 2026-09-30** on the operator's decision, the first lane under [ADR-0079](../adr/0079-parallel-lanes.md), built on `lane/D31`, with the decisions below confirmed as drafted (ledger §How D31 opened).
- Records: [ADR-0080](../adr/0080-interface-polish.md) (the grid header's controls, the drawer toggle's state, a centred auth card, a visible wait; deltas on ADR-0039, 0052 and 0054) — written `proposed` at scoping, accepted at the head of `D31.1`. Parents: [ADR-0039](../adr/0039-grid-filter-ux.md), [ADR-0052](../adr/0052-grid-and-admin-followups.md), [ADR-0054](../adr/0054-design-language-instrument.md). Amends none. **Adds no migration.**
- Ledger: [`docs/plan/README.md`](README.md)
- Notes: [`0031-interface-polish.notes.md`](0031-interface-polish.notes.md)

## Goal

Five changes the operator named after using both SPAs:

- the grid header's name becomes a label, with its sort and filter controls paired at the cell's end;
- the drawer toggle shows the drawer's state;
- the auth screens become one centred card on a gradient ground;
- the customer's "Change email" moves onto the email's row;
- no wait is blank.

The deliverable is short, frontend-only, and has records disjoint from D29's, so it is also the first test of running two lanes at once.

## Constraints

- Mechanical where it can be: no API, contract or schema change, and no new dependency.
- Colour, radius, type and spacing come from tokens, and no token is added (ADR-0054 §2; ADR-0080 §3).
- Generated primitives under `packages/ui/src/components/` stay byte-identical; the new behaviour lives in compositions and packages (ADR-0047, as carried).
- Every operator-facing string is a key in `en` and `lv`, and `pnpm i18n:check` holds (ADR-0046, as carried).
- A package's behaviour is certified in the package; an app's suite tests the binding (ADR-0077 §4).
- A spec under `docs/specs/` that names a changed test is updated in the same diff (ADR-0068 §1).
- `pnpm size` is measured at every step. A budget change is a diff of the budget file with its baseline, inside the headroom rule (ADR-0073 §5, as carried).
- The built `index.html` carries no inline script or style element (ADR-0074 §6).
- No record of ADR-0078's set is touched, so the lane condition holds (ADR-0079 §1). Nothing here restarts the operator's stack (`CLAUDE.md`).
- The gate as `CLAUDE.md` §Commands defines it, at every step.

## Decisions taken at scoping (2026-09-29)

These were recommended from the operator's list, and the operator confirmed them when D31 opened on 2026-09-30.

- **Sort is an icon button of its own**, named `"Sort by <header>"`, beside the filter's. The name is a label on every column, start-aligned, including end-aligned numeric columns.
- **The drawer toggle is the shell's composition**, using lucide's panel-close/panel-open pair and `aria-expanded`. Its accessible name is unchanged, so the tests that find it keep working.
- **The gradient runs between two existing tokens**, `--background` into `--primary-tint`. No new token.
- **Pending states:**
  - a router pending component behind a measured threshold, with a minimum display time;
  - `AppLoader`'s delay once per page load;
  - a static indicator in `index.html` (withdrawn at D31.4, operator);
  - skeletons stay.
  - Added at opening: the threshold and minimum are measured from the router's defaults, 1000 ms and 500 ms.
- **Recorded, not asked:** the admin has no self-service email change, so item 4 is the customer's alone. The security page and its sign-in-methods rows are D29's record set (ADR-0072 §4) and are only copied, never edited.

## Steps

Each step: implement, gate green, one bounded diff review, commit (ADR-0050). ADRs listed are what the builder reads first.

- [x] **1. Accept ADR-0080; the grid header and the drawer toggle.** Accept 0080 at the head, where [ADR-0039](../adr/0039-grid-filter-ux.md)'s status line gains its delta. The index row, the topic table and the ledger's window section say so. Write 0080's digest lines in `scripts/rules-digest.mjs`.
  - `@repo/grid`'s header cell renders the name as a label and the sort and filter controls at its end, per ADR-0080 §1, with the sort key in both catalogues.
  - The tests and the admin e2e spec that found sorting by the column's name find it by `"Sort by <header>"`.
  - `@repo/ui`'s `AppShell` renders its own drawer toggle per §2.

  **ADRs:** 0080 §1–§2, 0039 §"A filter icon in the header" as carried by 0052, 0054 §3–§4, 0047 as carried by 0074, 0048 as carried.
  **Done when:**
  - `pnpm test --filter=@repo/grid` green, with cases "the column's name is a label and sorts nothing", "the sort control is named for its column and shows the direction it holds" and "the header's controls sit at the cell's end in the order sort, filter";
  - `pnpm test --filter=@repo/ui` green, with case "the drawer toggle shows and announces whether the drawer is open", red with the static trigger restored;
  - `pnpm test:unit --filter admin` green;
  - `pnpm i18n:check` green;
  - `pnpm rules:digest` writes, then writes `0 of 3`;
  - `pnpm docs:check` clean;
  - `pnpm test:e2e` green in the admin;
  - the gate green.

- [x] **2. The auth card and the email's row.** [ADR-0054](../adr/0054-design-language-instrument.md)'s status line gains its delta at the head.
  - `@repo/app-kit`'s auth layout becomes one centred card on the token gradient, per ADR-0080 §3; the hairline ground and its inline style go.
  - Both apps' auth-layout suites and the admin's `login.spec.ts` assert the new geometry.
  - The customer profile's "Change email" moves onto the email's row, per §4.

  **ADRs:** 0080 §3–§4, 0054 §7 with its `D11.7` amendment, 0071 §6, 0077 §4.
  **Done when:**
  - `pnpm test --filter=@repo/app-kit` green, with case "the auth layout centres one card on a gradient drawn from tokens", red with the hairline ground restored;
  - `pnpm test:unit --filter customer` green, with case "the email's change action sits on the email's row";
  - `pnpm test:unit --filter admin` green;
  - `pnpm size` green;
  - `pnpm test:e2e` green in both apps;
  - the gate green.

- [x] **3. Every wait shows that it is waiting.** [ADR-0052](../adr/0052-grid-and-admin-followups.md)'s status line gains its delta at the head.
  - `@repo/app-kit` gains the pending component; both routers take it as their default, with a threshold and a minimum. The threshold is measured against the shell's indicator on the dev stack and recorded in the notes.
  - `AppLoader`'s delay runs once per page load.
  - Both `index.html` files carry a static indicator in their root (withdrawn at D31.4, operator: the roots are empty again).

  **ADRs:** 0080 §5, 0052 §"Felt navigation" and §Alternatives, 0046 (the loader above the i18n provider), 0074 §6.
  **Done when:**
  - `pnpm test --filter=@repo/app-kit` green, with cases "the pending state is visible and announced" and "a second boot gate shows the loader without a second delay";
  - `pnpm test:unit --filter admin` green, with case "a route whose loader outlasts the threshold shows the pending state", red with the default pending component removed;
  - `scripts/size.test.mjs` green, with case "the built page's root carries the boot indicator and no inline style" (renamed "the built page carries no inline style" at D31.4, when the indicator was withdrawn);
  - `pnpm size` green;
  - `pnpm test:e2e` green in both apps;
  - the gate green.

- [x] **4. Close-out.** `/frontend-conventions`, `/new-resource-ui` and the rule files describe the header's controls, the auth card and the pending state wherever they describe the old ones. Then regenerate the digests and run the definition of done.
      **ADRs:** 0080, 0065 as carried.
      **Done when:** the definition of done below, every item.

## Definition of done

Run at `D31.4` and again by `/ship` on the committed tree.

1. The gate green, every task cold: `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check`.
2. `pnpm test:unit` twice, the second `FULL TURBO`.
3. `pnpm size` green with both budget files' baselines equal to the measurement of the shipping commit.
4. `pnpm test:e2e` green in both apps against the local compose.
5. The operator's walk, accepted or pending by name, in both themes:
   - a grid header;
   - the drawer toggle, wide and narrow;
   - login, forgot password and reset password in both apps;
   - the customer's profile;
   - a cold load and a deep link to a record.
6. `pnpm rules:digest` writes nothing on a second run; `pnpm docs:check` clean.
7. The workspace test total equals the total at opening, recorded in the notes, plus the net-new counts the steps declared.

## Not in D31

Anything on the API, contracts or schema; the security page's sign-in-methods rows (ADR-0072 §4, D29's record set); a self-service email change for staff; skeleton copy; the sidebar's contents and the dashboard layout; D29's work.
