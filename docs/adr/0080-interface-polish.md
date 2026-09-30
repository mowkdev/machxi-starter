# ADR-0080: Interface polish — the grid header's controls, the drawer toggle's state, a centred auth card, and a visible wait (supersedes ADR-0039, 0052 and 0054 in part — deltas)

- Status: accepted
- Date: 2026-09-29
- Supersedes (each at the step that makes its delta true): [ADR-0039](0039-grid-filter-ux.md) as carried by [ADR-0052](0052-grid-and-admin-followups.md) (delta: §"A filter icon in the header" — the column's name is a label and sorting moves to an icon button beside the filter's; the filter button, its name and its active state stand); [ADR-0052](0052-grid-and-admin-followups.md) as carried by [ADR-0054](0054-design-language-instrument.md), [ADR-0057](0057-impersonation-sessions.md) and [ADR-0062](0062-frontend-build-and-shared-composition.md) (delta: §Alternatives' rejected "pending route component" is taken, behind a threshold; §"Felt navigation" and the shell's indicator stand); [ADR-0054](0054-design-language-instrument.md) (delta: §7's login — one centred card on a gradient ground, with the `D11.7` amendment's left-aligned column and hairline ground retired; every other surface of §7, and §2's tokens, stand). Every parent stands for everything not named here.

> Written 2026-09-29 by `/scope` for D31 ([`docs/plan/0031-interface-polish.md`](../plan/0031-interface-polish.md)), on the operator's list of the same day, with D30 in progress — writing is not opening, opening is not accepting. `proposed` at writing; **accepted 2026-09-30 at the head of `D31.1`**, where [ADR-0039](0039-grid-filter-ux.md) moved to `superseded by` for §1's delta; [ADR-0054](0054-design-language-instrument.md) moved at `D31.2` for §3's delta, and [ADR-0052](0052-grid-and-admin-followups.md) at `D31.3`, the steps that make their deltas true. Amendable in place, labelled, while D31 is `in progress` (ADR-0025 rule 2, as carried by ADR-0079).

## Context

The operator used both SPAs and named five things that read wrong. None is a defect a test catches; each is a place where the interface says less than it could.

The grid header crowds two controls of different shapes into one cell: the column name is itself the sort button, with its arrow embedded, and the filter is a separate icon button beside it (ADR-0039). The name reads as a link, the two controls do not look like a pair, and the cell's alignment follows the column's data. The shell's drawer toggle is shadcn's generated trigger with a fixed icon, so it does not say whether the drawer is open. The auth screens sit in a left-aligned column on a hairline grid (ADR-0054 §7, as the `D11.7` amendment read it). On the customer's profile, "Change email" sits in the card's header, away from the address it changes, while the security page puts "Change password" on the password's own row. And a wait can be blank: nothing renders while a route's chunk or loader resolves, since ADR-0052 rejected a pending route component; the boot gates stay blank for their first 250 ms each, and two run in sequence; and `index.html`'s root is empty until the script runs.

## Decision

A **delta** on three records. Every other decision of each parent, as carried, stands and is in force as part of this record.

### 1. The column's name is a label; its controls sit at the end

A header cell holds the column's name, start-aligned for every column and truncating, and after it, at the cell's end and clear of the resize handle, the column's controls: **sort**, then **filter**. Both are the same ghost icon button at the same size, and neither changes the header row's height. Sort renders only where the config allows a sort (ADR-0035, as carried), is named `"Sort by <header>"` through `@repo/grid`'s catalogue, and shows the direction it holds: an up or down arrow in the active treatment the filter uses, or a neutral two-way arrow at rest. `aria-sort` stays on the column header. The name sorts nothing. The filter button keeps ADR-0039's name, its `(filtered)` suffix and its active state.

### 2. The drawer toggle shows the drawer's state

The shell renders its own toggle in its composition, not shadcn's generated `SidebarTrigger`, since ADR-0047 keeps that primitive byte-identical and the toggle has always been the shell's (ADR-0048). The toggle reads the sidebar's context. On a wide screen it follows `open`, and on a narrow one `openMobile`. It shows a panel-close icon while the drawer is open and a panel-open icon while it is closed, from the icon library the packages already use, and says the same thing to assistive technology through `aria-expanded`. Its accessible name stays the `UiStrings` sentence, and the keyboard shortcut stands.

### 3. The auth surface is one centred card on a gradient ground

The auth layout is one card, centred on both axes, holding the brand line, the heading, the lede and the controls, at §7's width and card rungs. The ground is a gradient painted between existing tokens, `--background` and `--primary-tint`, so both themes follow from the token sheet and no colour or token is added. The hairline grid and its inline style retire. Every route that composes the layout inherits it.

**Amended 2026-09-30 (`D31.2`): the card is the layout's, and the ways out are inside it.** "One card" is read literally: the layout renders the card, and the pages that used to draw their own `Card` around the controls now hand the layout their body, since a page card inside the layout's card would be two. The pages' ways out — back to sign in, recovery, sign-up, "Continue with Google" — used to sit under the page's card because `D11.7` read a card's contents as the controls alone. With the heading inside the card too that reading no longer divides anything, so they sit under the controls inside the one card, in the same small type as before. The card takes §7's rungs as `D11.7` spelled them: a 400px cap, 20px padding and a 16px stack. The gradient runs to the bottom right, painted over `--background` so the tint's alpha has a surface.

### 4. A credential's change action sits on its row

On the customer's profile, "Change email" sits on the email's own row: the fact at the start, the action at the end, the shape the security page's rows already have. Who sees the action, and the flow it opens, are unchanged (ADR-0071 §6).

### 5. Every wait shows that it is waiting

- **Routes.** Both routers take a default pending component from `@repo/app-kit`: a spinner and a visible, localized "Loading…" in a polite status region. It appears only when a route's chunk or loader outlasts a threshold, and once shown it holds for a minimum, so a fast navigation never flashes it and a slow one never flickers. The threshold is above what the shell's indicator covers well, and the builder measures it. The indicator stands and still owns the first moments of a navigation.
- **Boot.** `AppLoader`'s delay runs once per page load, so gates in sequence read as one wait.
- **Before the script.** `index.html`'s root carries a static indicator, styled from the app's stylesheet, which the first render replaces. The built page stays free of inline script and style elements (ADR-0074 §6 stands).
- Skeletons stay the indicator for content inside a rendered page.

### 6. What this record declines

A new token or a raw colour; an edit to a generated primitive; dragging columns from the header (declined by ADR-0041); a pending component in place of the shell's indicator at every navigation, which was ADR-0052's objection and still is.

## Consequences

- Tests that found the sort control by the column's name now find it by `"Sort by <header>"`, and the header's text is the name alone.
- The auth screens' geometry assertions change with the layout, in the component tests and in the admin's browser spec.
- A deep link to a slow record route shows a pending state instead of nothing, and a slow navigation replaces the page with it after the threshold.
- The records this deliverable touches share none with ADR-0078's, and it adds no migration, so it can run beside D29 as a lane once [ADR-0079](0079-parallel-lanes.md) is in force.

## Alternatives considered

- **A clickable name as well as a sort icon.** Two targets for one action, and the name keeps reading as a link. Declined.
- **A new gradient token pair.** It would add tokens for one surface; the two it needs already exist in both themes.
- **Removing `AppLoader`'s delay.** It trades a blank quarter-second for a flash on every fast boot; running it once per page load keeps both.
- **An inline boot script that renders the indicator.** The content policy refuses inline scripts; static markup needs none.
