# ADR-0037: Grid viewport layout — a height-budgeted shell and one scroll container

- Status: proposed
- Date: 2026-08-20

> Written at the opening of D4 (data grid v2), alongside ADR-0038–0041. [ADR-0025](0025-deliverables.md) rule 3 keeps "agreed" and "built" as separate facts: `D4.1` implements this layout ([`docs/plan/0004-data-grid-v2.md`](../plan/0004-data-grid-v2.md)), and the sibling ADRs' surfaces — the toolbar, the filter bar, the record panes — are budgeted for here before any of them exists. It stays amendable in place while D4 is `in progress`.

## Context

D3 shipped the grid's *behaviour* — [ADR-0035](0035-config-driven-resource-ui.md)'s AppGrid on TanStack Table, manual everything, URL-held state — and never decided its *geometry*. What shipped is the geometry nobody chose: the page container under the dashboard shell is `flex flex-1 flex-col gap-4 p-4` with no height constraint, the Card grows with its content, the whole document scrolls, `TableHeader` is not sticky, and `GridPager` scrolls away with everything else. On a twenty-row page the operator scrolls past the grid to find the pager and loses the column headers on the way. That is the UX ask this ADR answers, but it is not the only fault — two of the faults are shipped bugs, and they share one root cause worth recording precisely because it is the failure class, not a failure instance.

**The flex floor.** `SidebarProvider` (`packages/ui/src/components/sidebar.tsx`) renders `div.flex.min-h-svh.w-full`; its children are the sidebar *gap* (`w-(--sidebar-width)`, a real in-flow width) and `SidebarInset` (`main.relative.flex.w-full.flex-1.flex-col`). The declared widths sum to 100% plus the sidebar width, and `flex-1` would absorb the excess — except a flex item's default is `min-width: auto`, which floors the inset at the min-content width of what it contains. What it contains is a table whose every `th` and `td` is `whitespace-nowrap` (`packages/ui/src/components/table.tsx`), so the inset cannot shrink below the widest row the data happens to produce, and the overflow escapes to the document as a page-level horizontal scrollbar. `min-w-0` appears nowhere in `apps/admin/src` or the sidebar chain — verified 2026-08-20. The second bug is the same bug wearing motion: the sidebar's collapse/expand is a 200ms `transition-[width]` on the gap, and it looks broken because the inset, floored at the table's min-content width, cannot yield or absorb the width the gap is animating through.

**Two nested scroll containers.** AppGrid wraps the table in its own `overflow-x-auto rounded-md border` div (`apps/admin/src/shared/grid/app-grid.tsx`), and `@repo/ui`'s `Table` *also* renders `div[data-slot=table-container].relative.w-full.overflow-x-auto` around the `<table>` — shadcn's generated default. The inner one is the one that actually scrolls; the outer one contributes a border whose radius the inner container's scrollbar clips. Neither was chosen over the other; they simply both exist.

**What D4 is about to stack on top.** The grid page today is `Card > CardHeader (title + create button) > CardContent > AppGrid`, and AppGrid internally renders an optional search div, the table wrapper and `GridPager`. The siblings add more chrome to that column: a toolbar region ([0038-grid-selection-and-capabilities.md](0038-grid-selection-and-capabilities.md)), an applied-filters bar and per-column header filter controls ([0039-grid-filter-ux.md](0039-grid-filter-ux.md)), record panes beside or over the grid ([0040-record-routes-and-edit-surfaces.md](0040-record-routes-and-edit-surfaces.md)), and persisted view preferences ([0041-grid-preferences.md](0041-grid-preferences.md)). Every one of them assumes a stable frame: static chrome, rows that scroll, a header that stays put. Deciding the frame once, before four features negotiate it piecemeal, is why this ADR exists.

## Decision

### Fix the flex floor at its root, in owned code

**`SidebarInset` gains `min-w-0`, and the dashboard page container gains `min-w-0`.** `packages/ui/src/components/sidebar.tsx` is shadcn-generated *owned* source — [ADR-0031](0031-ui-design-system.md)'s regenerate-and-diff model explicitly licenses local edits, at the stated cost of one more hunk in every future upstream diff, and per its convention the edit carries a comment at the point of change naming this ADR as the rule that forced it. With the floor removed, the width sum resolves the way the classes always claimed it would: `flex-1` absorbs the sidebar's width, and the 200ms width transition is absorbed by the inset **with no JS** — no ResizeObserver, no `useSidebar()` consumer, no measured widths.

The general rule, because `min-width: auto` is the whole failure class and not this one instance: **any flex or grid ancestor of the grid must carry `min-w-0` (and `min-h-0`, for the vertical budget below) wherever it is expected to shrink.** A wrapper that is supposed to yield and doesn't has this bug; the fix is one utility class at the wrapper, never a measurement.

### One scroll container, owned by AppGrid

**Exactly one element scrolls the grid, on both axes, and AppGrid owns it.** `@repo/ui`'s `Table` gains an opt-out of its internal `table-container` wrapper — a `container?: boolean` prop defaulting to `true`, or an exported unwrapped `table` primitive; the implementation may choose the mechanism, the decision is the invariant. AppGrid's own wrapper becomes that one container: `overflow-auto` (both axes — the horizontal scroll the double wrapper split between two divs, and the vertical scroll the next section gives it). The second edit to generated source is licensed and priced the same way as the first, and defaulting the prop to `true` keeps every other `Table` consumer byte-compatible with upstream behaviour.

### A height-budgeted grid shell, opt-in per page

**Grid pages become viewport-filling; the budget is flex, not arithmetic.** `SidebarProvider`'s `min-h-svh` already makes the viewport the frame's height whenever content fits; what is missing is a chain that lets the grid *receive* that height instead of growing past it. The chain from `SidebarInset` down carries `flex flex-col min-h-0`, the page container gets a full-height variant, and the Card becomes a flex column filling what remains:

```
SidebarProvider        div.flex.min-h-svh.w-full
├── (sidebar gap)      w-(--sidebar-width), 200ms transition-[width]
└── SidebarInset       main.flex.w-full.flex-1.flex-col  + min-w-0        ← §flex floor
    ├── header         h-16 shrink-0                                       (unchanged)
    └── page container flex flex-1 flex-col gap-4 p-4 min-w-0
        │              + min-h-0 (full-height variant, grid pages only)
        └── Card       flex flex-col flex-1 min-h-0
            └── CardContent  flex flex-col flex-1 min-h-0
                └── AppGrid  flex flex-col flex-1 min-h-0
                    ├── toolbar region        static   (ADR-0038's surface)
                    ├── applied-filters bar   static   (ADR-0039's surface)
                    ├── scroll body           flex-1 min-h-0 overflow-auto  ← the one container
                    │   └── <table> — thead sticky top-0, opaque bg-*
                    └── GridPager             static footer
```

- **The scroll body is §one-container's element**, now scrolling both axes. `TableHeader` is sticky *within it* — `sticky top-0` plus an opaque `bg-*` so rows visibly pass under it rather than through it. Because ADR-0035's filter row lives inside the `thead`, it sticks with the headers for free.
- **The header and the pager never move.** The toolbar, filter bar and pager are static siblings of the scroll body; scrolling the rows is the only scrolling a grid page does.
- **A minimum height floor** (on the order of `min-h-64`; the exact value is implementation) protects absurdly short viewports: when the floor makes the column taller than `svh`, the `min-h-svh` wrapper grows past the viewport and the *document* scrolls — a graceful degradation to D3's behaviour instead of a grid crushed to two rows.
- **Full-height mode is a page choice, not a shell default.** Grid pages (staff, users) opt in; non-grid pages (profile, the dashboard index) keep normal document flow, because a form taller than the viewport should scroll as a document, not inside a pane.

The sticky `thead` is also the anchor surface for [0039-grid-filter-ux.md](0039-grid-filter-ux.md)'s per-column filter controls — the header filter buttons live on cells that never scroll away, which is what makes them reachable while reading row two hundred, and the two ADRs agree on that sentence.

### Custom scrollbar styling, once, in the design system

The one scroll container gets a design-system scrollbar rather than the platform default: a utility (e.g. `.scrollbar-thin`) defined in `packages/ui`'s `globals.css` against the [ADR-0031](0031-ui-design-system.md) theme tokens, applied by AppGrid's scroll body. Both engines from the same tokens — `scrollbar-width` / `scrollbar-color` for the Firefox standard properties, `::-webkit-scrollbar*` pseudo-elements for WebKit/Blink — so light and dark answer from the palette the way every other surface does. Defined once because it is a token concern, not a grid concern; the next scrollable pane (ADR-0040's) applies the same class.

### What this does not decide

- **What fills the toolbar and filter bar** — [0038-grid-selection-and-capabilities.md](0038-grid-selection-and-capabilities.md) and [0039-grid-filter-ux.md](0039-grid-filter-ux.md) own their regions; this ADR reserves the rows in the column.
- **Where record panes mount and how they split the viewport** — [0040-record-routes-and-edit-surfaces.md](0040-record-routes-and-edit-surfaces.md), which inherits the same flex contract.
- **Whether any of this geometry is a persisted preference** — [0041-grid-preferences.md](0041-grid-preferences.md).

## Consequences

- **`packages/ui` diverges from generated upstream in two components** — `sidebar.tsx` (`min-w-0` on `SidebarInset`) and `table.tsx` (the container opt-out). That is the regenerate-and-diff cost ADR-0031 named as the ownership model's price, paid twice more, each hunk commented with the rule that forced it so a future upstream diff review keeps or re-applies it deliberately.
- **Grid pages and non-grid pages now have different vertical strategies** — pane scroll versus document scroll — and `D4.1` must verify both: the grid page at tall, short and floor-triggering viewports, and a non-grid page confirming nothing constrained its natural flow.
- **The chain is fragile to careless wrapper insertion.** `sticky` plus `flex-1 min-h-0` works only while every ancestor between `SidebarInset` and AppGrid keeps the contract; one innocent `<div>` without `flex flex-col min-h-0` silently restores document scroll and unsticks the header. The rule is recorded here so a review can cite it: **a new wrapper on the grid path carries the flex contract or does not get inserted.**
- **The sidebar animation is fixed as a side effect**, and fixed the cheap way — one class, no JS, no measurement — which is the §flex-floor rule earning its place as a rule rather than a patch.
- **Scrollbar pseudo-element styling is non-standard but progressive**: WebKit's `::-webkit-scrollbar*` is not on a standards track, and Firefox ignores it while honouring the two standard properties — every engine gets a themed scrollbar, just not pixel-identical ones. Acceptable, and cheaper than a JS scrollbar library by every measure that matters here.
- **The stacking context grows one occupant.** The sticky header sits above the rows it lets pass under; anything a sibling ADR floats inside the scroll body (ADR-0039's filter popovers, ADR-0038's row menus) must layer against it knowingly.

## Alternatives considered

- **Leave document scroll and only fix the `min-w-0` bugs.** The minimal correct fix for both shipped bugs — and it delivers none of the UX ask: headers still scroll away, the pager still hides below twenty rows, and every D4 sibling still has no stable frame to mount on. Rejected as answering the bug report while ignoring the deliverable.
- **`height: calc(100vh - …)` on the grid.** Works on day one and breaks the day the header, a banner or an ADR-0038 toolbar changes height — the magic number encodes the chrome's dimensions in a second place. Flex budgeting encodes no dimensions at all; chrome takes what it declares and the scroll body takes the rest, whatever the rest is.
- **JS measurement / ResizeObserver.** Solves exactly what `flex-1 min-h-0` solves declaratively, at the price of a resize subscription, a render-measure-render cycle and a seam every test must fake. The declarative version is also what makes the sidebar transition free; the measured version would have to animate in step with it.
- **Virtualise the rows instead of scrolling a pane.** Still pointless under a contract that caps a page at `MAX_LIMIT` (100) rows — [ADR-0035](0035-config-driven-resource-ui.md) already made this argument when it declined a component-library grid, and nothing about a height budget changes the row count. It would also trade the semantic `<table>` that ADR-0036's role queries rely on for a div-grid, which is the same trade ADR-0035 refused.
- **Fix the double wrapper by nesting overflow instead of an opt-out** — `overflow-visible` or `contents` hacks on `Table`'s internal container so the outer div wins. Leaves two elements claiming the scroll job and one pretending not to have it, keeps the clipped radius one refactor away from returning, and makes sticky-header offsets depend on which wrapper is currently winning. One owner is the decision; the opt-out is just its cheapest spelling.
