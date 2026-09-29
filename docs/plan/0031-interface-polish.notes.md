# D31 — Interface polish: build notes

The per-step build record of [D31](0031-interface-polish.md). It holds what was built, the amendments, the review findings and their fates, the gate's output, and what is pending the operator. It is kept apart from the executable plan so that a builder opens the plan and not the journal ([ADR-0068](../adr/0068-behaviour-specs-and-plan-notes.md) §2, the plan apart from its notes). `/step` appends here; `/ship` and the close-out read it.

## D31.1 — Accept ADR-0080; the grid header and the drawer toggle (2026-09-30)

**Built.** [ADR-0080](../adr/0080-interface-polish.md) accepted at the head. [ADR-0039](../adr/0039-grid-filter-ux.md) moved to `superseded by` with its delta stated: the column's name is a label, and sort is an icon button beside the filter's. The index rows for 0080 and 0039, the topic table's grid row and the ledger's window paragraph say so. `scripts/rules-digest.mjs` carries 0080's lines for what this step builds: "The grid" now cites 0080 and describes the header's controls, and a new "The drawer toggle" line has been added. The auth card and the pending state get their lines at `D31.2` and `D31.3`, when those behaviours exist.

- `@repo/grid`'s header cell (`app-grid/header.tsx`): the name is a start-aligned label on every column, end-aligned ones included. It sorts nothing and truncates when it is text. After it, in `data-slot="grid-header-controls"`, come sort then filter, both `size-7` ghost icon buttons. Sort is named `Sort by <header>` (new key `sort.trigger`, `en` and `lv`). At rest it shows a neutral `ArrowUpDown`; once sorted it shows an up or down arrow in the filter's `bg-accent` treatment, with `data-active` and `data-direction`. `aria-sort` stays on the `th`.
- `@repo/ui`'s `AppShell` renders its own `DrawerToggle` in place of the generated `SidebarTrigger`. It reads `useSidebar()` (`openMobile` when narrow, `open` when wide), shows `PanelLeftClose` or `PanelLeftOpen`, and sets `aria-expanded`. The name and the primitive's `data-*` attributes are unchanged, and `sidebar.tsx` is untouched.
- The tests that found sorting by the column's name now find it by `"Sort by <header>"`: `demo-grid.test.tsx`, the admin's `staff-page.test.tsx` and `search-serialization.test.tsx`, and `e2e/grid-state.spec.ts`.

**Net-new tests: 4.** `@repo/grid` gained three: "the column's name is a label and sorts nothing", "the sort control is named for its column and shows the direction it holds", and "the header's controls sit at the cell's end in the order sort, filter". `@repo/ui` gained one: "the drawer toggle shows and announces whether the drawer is open", which was checked red with the static `SidebarTrigger` restored.

**Where it was built.** In the worktree `.claude/worktrees/lane-D31` on `lane/D31`, on the operator's decision of the same day (§How D29 opened): the main checkout stays on `main` under the dev stack. The first two gate runs used the shared `machxi_test` and failed only in `api#test`, once on a `CONNECT_TIMEOUT` and once on 401s and extra audit rows, a sign of another process working on the same database. This diff touches no API code. On the operator's decision this lane then got its own test database, `machxi_d31_test`, named in a local, skip-worktree `apps/api/.env.test` and exported for `@repo/db`'s suites.

**Gate** (with `main` merged in: already up to date), against `machxi_d31_test`, the test task forced cold: `pnpm lint && pnpm check-types && pnpm test --force && pnpm size && pnpm format:check`. Green: test 17 of 17 tasks, size 4 of 4 with every figure `ok` (admin js 368.2 / 383.8 kB, customer js 312.1 / 324.2 kB), and Prettier clean. `pnpm rules:digest` wrote 1 of 3, then 0 of 3. `pnpm docs:check` and `pnpm i18n:check` were clean.

**Review** (`code-reviewer`, one pass), both findings fixed:

1. `truncate`'s `overflow: hidden` on the label span would clip the focus ring of a header that is a control, the selection column's select-all checkbox. It was a likely finding, since jsdom cannot paint. Fixed: `truncate` applies only when the column's header is a string. Re-verified with `turbo run lint check-types test --filter=@repo/grid --filter=admin --force` (30 of 30) and `pnpm format:check`.
2. The e2e case was titled "a header click sorts". It was renamed "the header's sort control sorts".

**Pending.**

- The merge to `main` and `pnpm test:e2e` in the admin are the coordinator's. The dev stack serves the main checkout, so the e2e sees this change only after the merge. The step is done when that passes.
- Pending operator acceptance (browser-only geometry): the grid header, and the drawer toggle wide and narrow, in both themes.
- The commit `docs(plan): open D29` (7bb1f06) landed on `lane/D31` rather than `main` before the worktree move, and reaches `main` with this lane's merge.
