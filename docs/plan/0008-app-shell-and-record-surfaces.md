# D8 — App shell and record surfaces

- Status: **planned** — opens when D7 ships (it has: 2026-08-22)
- Steps: written when the deliverable opens; this file carries scope, order rationale and the decisions taken
- Ledger: [`docs/plan/README.md`](README.md)

Scope: the two compositions every screen in both SPAs is built from — **the application shell** and **the record surface** — designed as generic, slotted components in `@repo/ui`, with `apps/admin` adopting them as the first consumer. Nothing behavioural moves in this deliverable: the grid, the API client, the resource config and the form machinery stay exactly where they are (that is [D9](0009-platform-extraction.md)). What moves is presentation, and what changes is that two hardcoded layouts become two designed ones.

**This is design work, not a move**, and that is why it comes before the extraction. `apps/admin` is a working consumer with a full test tier and a browser walk; generalising the shell and the surfaces **against it, in place** is the cheapest verification available. D9 afterwards is then a mechanical relocation whose "no behaviour change" claim is checkable by test totals.

## Why now rather than with the customer app

The scope document these two deliverables were split out of made the opposite argument — _"an extraction with one consumer is speculation with extra folders; the second app is the forcing function."_ That argument stands in general and is answered specifically here: **the second consumer's requirements are already known** (a collapsing nav drawer, header chrome placed differently from the admin panel's, and create/edit surfaces in three shells), and both compositions are ones the customer app cannot be written without. The risk the old argument names is speculative generality, and the plan carries a rule against it rather than a hope:

> **Every slot and every variant must answer a need this repository can name today** — a screen in `apps/admin`, a stated requirement of the customer app ([D11](0011-customer-app.md)), or an invariant a frozen ADR already imposes. A slot added because it "might be useful" is a review failure.

## What is wrong with today's two layouts

Both gaps are real and were read out of the code rather than assumed.

**The record surface scrolls the wrong thing.** `apps/admin/src/shared/form/app-form-surface.tsx` puts `overflow-y-auto` on the drawer's entire `SheetContent`, so the title scrolls away with the fields; there is no fixed footer region at all (the actions are a `FOOTER` class string inside the scrolling body); the modal has exactly one width; and the footer's contents are fixed — `AppFormActions` and nothing else. A form long enough to scroll therefore loses both its title and its Save button, which is the case the operator most needs them.

**The shell has no slots.** `apps/admin/src/widgets/dashboard-layout/index.tsx` hardcodes its header as `SidebarTrigger + Separator + <h1>{title}</h1>`. There is nowhere to put an action, a breadcrumb or a status control, which is why theme, locale and logout ended up in the _sidebar footer_ — not because that is where they belong, but because it was the only region that took children. A second app that wants them in the header would have to fork the layout.

## The shell

A composition over `@repo/ui`'s `sidebar-07` primitives, which **knows nothing about routing or authorization**: navigation arrives as JSX, so the `can()` join (ADR-0042) and the typed route links stay in the app that owns them.

- **`brand`**, **`nav`**, **`sidebarFooter`** — the drawer's three regions. `collapsible="icon"` behaviour and the mobile `Sheet` swap are the primitive's, unchanged.
- **`headerStart`** / **`headerEnd`** — the fix for the stranded chrome. The trigger stays the shell's; everything beside it is the app's, on either side.
- **`breadcrumbs`** — `packages/ui/src/components/breadcrumb.tsx` has been in the package since D3.1 and has never been rendered. The shell is where it belongs.
- **The page header** — a title-and-actions row for a page, replacing the ad-hoc `CardHeader` / `CardAction` usage. The grid toolbar keeps its own actions (ADR-0038 put Create there deliberately at D4.3); this serves the pages that are not grids.
- **`banner`** — a full-width region above the header, and a standard shell region rather than a speculative one: every app of this shape eventually needs somewhere to say something about the whole session. It is **dumb by construction** — it renders what it is handed and reserves no space when handed nothing. The shell must not learn _why_ a banner is showing, because a shell that read the principal would drag the session store and `@repo/contracts`'s principal type into `@repo/ui`, which ADR-0031's dependency rule and [ADR-0023](../adr/0023-shared-contracts-package.md) both exist to prevent.

  It comes with a generic **`Banner`** component beside it — variants, a message, an action slot, and a **`dismissible`** flag, because its first real consumer needs `dismissible={false}`. `@repo/ui` has no `alert` primitive today, so whether this is built on shadcn's or hand-written is the ADR's call.

  **The named consumers, in order of certainty**: [D12](0012-impersonation.md)'s impersonation banner, which reads `principal.impersonatedBy` and renders into this slot — the field on the principal and the banner itself are D12's to add, not this deliverable's; then offline, maintenance and read-only notices. In `apps/admin` today the honest consumer is the dev-only pseudo-locale notice: `VITE_I18N_PSEUDO` (D7) is on and nothing says so on screen, which is a real if small need and makes the slot _exercised_ rather than merely offered. A slot with no consumer at all is the defect this repository recorded twice about the `page` edit surface, and the deliverable should not add a third.

- **The page container**, carrying [ADR-0037](../adr/0037-grid-viewport-layout.md)'s height contract unchanged — `min-w-0` always, `min-h-0` and `h-svh` in full-height mode. This is load-bearing for every grid and is the part of the shell most easily broken by a redesign; the deliverable's definition of done says so explicitly.

**Deliberately out of scope, each with its consequence stated rather than left to be discovered:**

- **Navigation as a typed data array.** Nav stays a JSX slot: a data-driven nav would pull the `can()` filtering and the route-tree types into the shell, and ADR-0042's containment carve-out means "which entries render" is a per-app judgement, not a shell rule.
- **Command palette, global search, tenant switcher.** Named so that nobody wonders whether they were forgotten.

## The record surface

One container in three variants — `modal`, `drawer`, `page` — replacing the shells inside `app-form-surface.tsx`:

```
┌─ Header ─────────────┐  fixed: title, description, close
├─ Body ───────────────┤  scrolls: overflow-y-auto, min-h-0
└─ Footer ─────────────┘  fixed: slot — submit, cancel, destructive actions
```

Three decisions the ADR must make explicitly, because each has a wrong answer that looks right:

1. **The `<form>` element wraps header, body and footer; only the body scrolls.** This is what makes a `type="submit"` button work in a _fixed_ footer, and what lets that footer read `isPending` / `isDirty` / `isValid` through `useFormContext`. The alternative — a button outside the form carrying `form="<id>"` — needs id plumbing through every surface and still leaves the footer outside the context it needs.
2. **The container is content-agnostic.** Container and RHF frame are fused today; splitting them means the same surface serves a detail view, a confirmation with a long body, or a future wizard, and that `AppFormFrame` (ADR-0035's one form frame) renders _inside_ it rather than beside it.
3. **Sizes are a token set**, not free values: modal `sm | md | lg | xl | full`, drawer widths likewise.

Everything already decided about these shells carries over unchanged and is the surface's job to preserve: the URL is identical across all three variants and closing is a navigation ([ADR-0044](../adr/0044-record-routes-without-list-state.md)); the submit lock refuses dismissal while a mutation is in flight, including the page variant's navigation blocker; and the title is a real heading in all three — the accessibility defect `D4.2` found by testing the shells against each other.

## Decisions this deliverable needs

- **A superseding ADR for [ADR-0031](../adr/0031-ui-design-system.md).** The operator's call is that these compositions live in `@repo/ui`, and 0031 is frozen and says the opposite in as many words: _"the layout composition an app owns lives in the app, the primitives it is built from live here."_ Diverging from that is a supersession, and [ADR-0024](../adr/0024-adr-lifecycle.md) rule 1 means the successor carries **the whole** of 0031 — the shadcn ownership model, the regenerate-and-diff rule, the dependency-location rule with its three amendments, the prettier carve-out, the one-door pattern — with one section changed: what kind of code the package may hold. 0031 is 103 lines; this is the largest single writing task in the deliverable and its first step. The alternative that avoided it (a separate compositions package) was considered and rejected by the operator in favour of one door per app.
- **The shell and record-surface ADR** — the slots, the three variants, the size tokens, the form-wrapping rule, and the ADR-0037 height contract restated as this component's responsibility. Additive beside frozen [0035](../adr/0035-config-driven-resource-ui.md), [0037](../adr/0037-grid-viewport-layout.md) and [0044](../adr/0044-record-routes-without-list-state.md); if it needs any of them to say something different, that is discovered at writing time and becomes a second supersession rather than a divergence.

## Acceptance sketch

`apps/admin` renders every screen through the new shell with no visual regression and no change to the URL of anything; the grid's height budget still holds — no page-level horizontal scrollbar, header and pager static, only rows scrolling — because that is the contract most at risk from this work; a form longer than the viewport keeps its title and its Save button visible in both the modal and the drawer, in every size token; the three-shell parity suite still passes against all three variants including the page one no resource declares; theme and locale render from the header slot rather than the sidebar footer, proving the slot rather than merely offering it; the gate is green with `@repo/ui`'s own suite extended; and the superseding ADR carries all of 0031 rather than a delta.
