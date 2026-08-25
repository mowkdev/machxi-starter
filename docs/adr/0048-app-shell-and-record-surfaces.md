# ADR-0048: App shell and record surfaces

- Status: proposed
- Date: 2026-08-22

> One of the D8 (app shell and record surfaces) decision pair, written 2026-08-22 **ahead of D8 opening** — writing is not opening, the D4 precedent used for the fourth time, and here with a sharper edge: D8's plan file ([`docs/plan/0008-app-shell-and-record-surfaces.md`](../plan/0008-app-shell-and-record-surfaces.md)) is still a scope document without steps, and per the ledger writing its steps is itself a decision nobody has taken. This record stays `proposed` until it is accepted at the head of the deliverable's first implementing step ([ADR-0025](0025-deliverables.md) rule 3), and becomes amendable in place only while D8 is `in progress` in [`docs/plan/README.md`](../plan/README.md) (rule 2). **It supersedes nothing.** It is additive beside frozen [ADR-0035](0035-config-driven-resource-ui.md), [ADR-0037](0037-grid-viewport-layout.md) and [ADR-0044](0044-record-routes-without-list-state.md), whose invariants it restates as one component's responsibility rather than changes. Its sibling is **[ADR-0047](0047-ui-package-scope.md), the supersession of frozen [ADR-0031](0031-ui-design-system.md)** the plan names as the deliverable's first step and largest writing task — written the same day, `proposed` beside this record, and accepted at the head of D8's first implementing step by the same rule. This record depends on it: 0031 as it stands says *"the layout composition an app owns lives in the app, the primitives it is built from live here"*, and everything below that puts a composition in `@repo/ui` is licensed by ADR-0047's changed what-code-the-package-may-hold section, not by this record.

## Context

Every screen in `apps/admin` is built from two layouts nobody designed, and the planned customer SPA ([D11](../plan/0011-customer-app.md)) will need both. D8 is design work, not a move: the shell and the record surface become generic, slotted compositions in `@repo/ui`, generalised **against the working consumer, in place** — `apps/admin` with its full test tier is the cheapest verification available — while every piece of behavioural machinery (grid, API client, resource config, form machinery) stays exactly where it is, so that [D9](../plan/0009-platform-extraction.md)'s extraction afterwards is mechanical and checkable by test totals.

**The record surface scrolls the wrong thing.** `apps/admin/src/shared/form/app-form-surface.tsx` puts `overflow-y-auto` on the drawer's entire `SheetContent` with `SheetHeader` inside it, so the title scrolls away with the fields; the footer is a class string (`FOOTER = "mt-6 flex justify-end gap-2"`) rendered *inside* the scrolling body, so Save scrolls away too; `AppFormDialog` passes no `className`, so the modal has exactly `DialogContent`'s one `sm:max-w-lg` width; and the footer's contents are `AppFormActions` and nothing else. A form long enough to scroll loses both its title and its Save button — the case in which the operator most needs them.

**The shell has no slots.** `apps/admin/src/widgets/dashboard-layout/index.tsx` hardcodes its header as `SidebarTrigger + Separator + <h1>{title}</h1>`. There is nowhere to put an action, a breadcrumb or a status control. Two corrections to the plan's framing belong here rather than in a later step's surprise:

- **The stranded chrome was placed deliberately, not accidentally.** The plan says theme, locale and logout landed in the sidebar footer "because it was the only region that took children"; the code records the opposite reasoning — [ADR-0032](0032-admin-app-architecture.md) assigns "navigation, current-principal block, logout" to `widgets/app-sidebar`, and D6.3/D7.5 put the preferences in the account menu on purpose ("a preference about the operator, in the menu named after them"). Moving them to the header is therefore a **reversal this record argues** (§Decision 2), not an accident it fixes.
- **The breadcrumb is not unrendered in the sense claimed.** `shared/ui/index.ts` has exported six breadcrumb symbols since D3.3, `packages/ui`'s own suite renders `Breadcrumb`/`BreadcrumbEllipsis`, and the `breadcrumb`/`more` `UiStrings` keys already have a `t()` call site and an `lv` entry. What is true is narrower: **no admin screen composes one**. No door widening is needed, and the stale "never reached the `shared/ui` door" comment in `apps/admin/src/app/providers/ui-strings.tsx` is corrected by whichever step first renders one.

Against speculative generality the plan carries a governing rule this record adopts as its own: **every slot and every variant must answer a need the repository can name today** — an `apps/admin` screen, a customer-app requirement written into [D11's plan](../plan/0011-customer-app.md), or an invariant a frozen ADR already imposes. Today D11's file states its needs only generically ("whichever shell slots this app fills differently from the admin panel"), so any slot below that cites D11 must have its requirement **written into `docs/plan/0011-customer-app.md` in the same change** — the citation is not allowed to point at a sentence that does not exist.

Two packaging facts frame everything below. `@repo/ui` declares only design-system runtime dependencies (`class-variance-authority`, `clsx`, `lucide-react`, `radix-ui`, `sonner`, `tailwind-merge`, `tailwindcss`, `tw-animate-css`) plus react/react-dom peers — **no `react-hook-form` and no `@tanstack/react-router`** — and two of the plan's own record-surface promises (a footer reading `isPending`/`isDirty`/`isValid` through `useFormContext`; the page variant's `useBlocker` navigation blocker) each require one of those. And [ADR-0046](0046-interface-localization.md) §12 forbids the package an i18n dependency while §13 gives *shared packages* a `register(i18n)` route — two incompatible mechanisms, and D8 is the first work that must choose between them for `@repo/ui` specifically.

## Decision

### 1. Both compositions live in `@repo/ui`, on a new hand-written path, and the package gains no dependency

**The shell and the record-surface container are compositions in `@repo/ui`**, under a path outside `components/` and `hooks/` — the `ui-strings.tsx` precedent, which is what keeps them formatted (the `.prettierignore` carve-out covers only those two directories) and outside [ADR-0031](0031-ui-design-system.md)'s regenerate-and-diff surface:

```
packages/ui/src/
├── components/           # generated primitives — byte-identical to CLI output, unchanged
├── compositions/         # hand-written; prettier applies; not under regenerate-and-diff
│   ├── app-shell.tsx     # "use client"
│   ├── banner.tsx
│   └── record-surface.tsx  # "use client"
└── ui-strings.tsx        # the precedent (D7.3)
```

- **Every new path costs three coordinated edits, made together**: an `exports` entry (`"./compositions/*"` or per-file), a pattern in `apps/admin`'s `no-restricted-imports` group beside `components/*`, `hooks/*`, `lib/*` and `@repo/ui/ui-strings`, and a named re-export through `shared/ui/index.ts`. A path added without the lint pattern is a hole the one-door rule cannot see; D7.3 established the triple and this repeats it.
- **Neither `react-hook-form` nor `@tanstack/react-router` enters `@repo/ui`.** The container is **geometry-only**. `AppFormFrame` (react-hook-form) and the page variant's `useBlocker` stay in `apps/admin` as thin wrappers around the container (§4). This keeps the shell's own rule — it knows nothing about routing — true of the package, keeps ADR-0047's dependency-location rule minimal, and charges one honest price: D9's file-count table, which assumes "the surfaces D8 moved to `@repo/ui`", takes a **one-line correction** when D8's build order is written — the geometry moved, the two behavioural wrappers stayed.
- **Stateful compositions carry `"use client"`.** `apps/web` compiles the package through `transpilePackages`, and a composition without the directive is unimportable from a Next server component. ADR-0031's stated coupling cost — a change to a shared primitive is a change to both apps — now applies to compositions too.
- **Composition micro-copy is `UiStrings` keys** — new keys with English defaults, fed from `apps/admin`'s `common:ui.*` exactly as the existing thirteen are; anything content-like stays a slot the app fills with its own JSX. The Banner's dismiss-control label is the first concrete key. ADR-0046 §13's `register(i18n)` route is **not** used for `@repo/ui`: it would give the package the i18n dependency §12 forbids, and §12's mechanism already exists and costs one key per string. The surface's own close needs **no new string**: `DialogContent` and `SheetContent` already render a localized close button behind `showCloseButton`.

### 2. The shell: one slotted composition over the sidebar-07 primitives

A composition that **knows nothing about routing or authorization** — navigation arrives as JSX, so the `can()` join ([ADR-0042](0042-client-side-authorization.md)) and the typed route links stay in the app that owns them:

```tsx
// packages/ui/src/compositions/app-shell.tsx — illustrative of shape and naming
export const AppShell = ({
  brand, nav, sidebarFooter,   // the drawer's three regions; collapsible="icon" and the
                               //   mobile Sheet swap are the primitive's, unchanged
  headerStart, headerEnd,      // either side of the trigger, which stays the shell's
  breadcrumbs,                 // renders the existing breadcrumb primitives in the header row
  banner,                      // full-width region above the header — §3
  title, pageActions,          // the page header: a title-and-actions row — the row the <h1> lives in
  fullHeight = false,          // ADR-0037's per-page opt-in, unchanged in meaning
  children,                    // the page, inside the page container
}: AppShellProps) => …
```

Each slot answers a nameable need: `brand`/`nav`/`sidebarFooter` are the admin sidebar's three existing regions; `headerStart`/`headerEnd` are the admin panel's own stranded chrome; `breadcrumbs` gives the long-exported primitives their first composed screen; `banner` has D12 and the pseudo-locale notice (§3); the page header serves the non-grid pages that today improvise with `CardHeader`/`CardAction` (the grid toolbar keeps its own actions — [ADR-0038](0038-grid-selection-and-capabilities.md) put Create there deliberately).

- **The page container carries [ADR-0037](0037-grid-viewport-layout.md)'s height contract unchanged, as this component's responsibility**: `min-w-0` always; `min-h-0` on the container and `h-svh` on the inset in full-height mode; the flex chain below it untouched. The machine-checkable surface is preserved literally: **`data-slot="page-container"` and `data-full-height` stay on the same element**, because three routing tests read the geometry through those two attributes and nothing else — jsdom lays nothing out, so they are the cheapest thing the new shell can be held to. The `fullHeight` join point is untouched in meaning: the record routes' `staticData` expressions (`fullHeight: editSurfaceOf(config) !== "page"`) keep meaning what they mean, because §4 does not change what the `page` variant does to the grid underneath.
- **The shell keeps the screen's single `<h1>`, and the page header is the row it lives in.** Today the shell renders `staticData.title` as the only `<h1>` and the grid pages repeat the same string as a `CardTitle` — a styled `div`, not a heading, which is the only reason nine `getByRole("heading")` queries match one element. The title the app hands the shell renders as the one `<h1>`, in the page-header row beside `pageActions`; **grid pages drop the duplicated `CardTitle`**. Every existing heading query keeps matching exactly one element, and the [ADR-0044](0044-record-routes-without-list-state.md) invariant that a record surface's title is a real heading is unaffected — an open surface is a `role="dialog"` with its own accessible name, not a second document heading.
- **The whole `AccountMenu` dropdown moves to `headerEnd`** — the slot's proving consumer. This **reverses the placement half of D6.3/D7.5 deliberately**: those steps put theme and locale in the account menu because a preference about the operator belongs in the menu named after them, and that reasoning survives — the menu is intact, `ThemeMenuItems`/`LocaleMenuItems` keep their `DropdownMenuRadioGroup` shape and its screen-reader semantics, and nothing about the two feature components changes. What changes is where the menu mounts, and the argument is D11's: **header chrome is exactly what the second app places differently**, so the shell's header must be able to hold it — a requirement written into `docs/plan/0011-customer-app.md` in the same change, per the slot-honesty rule. Moving the bare menu-item fragments instead would force both features out of the radio-group pattern; the cheap move is the whole menu.
- **`widgets/dashboard-layout` survives as a thin adapter over `AppShell`** — it supplies the slots from the app's routing, `can()` join and features, and stays the `_dashboard` layout component. This is a design constraint, stated so [ADR-0032](0032-admin-app-architecture.md) (frozen, and explicit that shells live in the `widgets` layer) is honoured rather than diverged from: the layer still owns the composition's *contents*; the package owns its *geometry*.

**Deliberately out of scope, named so nobody wonders whether they were forgotten**: navigation as a typed data array (ADR-0042's containment carve-out keeps "which entries render" a per-app judgement); command palette; global search; tenant switcher; and everything D12 puts *in* the banner — the `impersonatedBy` field on the principal and the `ImpersonationBanner` itself are [D12](../plan/0012-impersonation.md)'s.

### 3. The banner: a dumb region and a hand-written component

- **The `banner` slot is a `shrink-0` in-flow sibling above the header, and it renders nothing at all — not an empty `div` — when handed nothing.** It sits inside the `h-svh` box in full-height mode, so ADR-0037's flex budgeting absorbs it without arithmetic: chrome takes what it declares and the scroll body takes the rest. That is the existing argument restated, not a new one; an empty element that reserved space would shift every grid page's budget.
- **`Banner` is a generic component in the compositions path, hand-written rather than built on shadcn's alert primitive** (which the package does not carry): variants, a `message`, an `action` slot, and a `dismissible` flag — included now because its first real consumer, D12's impersonation banner, needs `dismissible={false}`. It is **dumb by construction: no `@repo/contracts` import**, no principal, no session store — a checkable boundary, and the reason the shell never learns *why* a banner is showing.
- **The in-admin consumer is the dev-only pseudo-locale notice, and its condition is a prop.** `VITE_I18N_PSEUDO` only sets the app's default; the notice's visibility arrives as a prop the test harness can set (a `renderApp` option). Gating it on the config variable directly would render it in no test in the repository — the admin vitest config pins `VITE_I18N_PSEUDO` to `"false"` for the whole suite on purpose — which is the same unexercised-surface defect this repository has recorded twice about the `page` edit surface.

### 4. The record surface: one geometry-only container, three variants, both mounts

One content-agnostic container replaces the shells inside `app-form-surface.tsx` — fixed header, scrolling body, fixed footer:

```tsx
// packages/ui/src/compositions/record-surface.tsx — illustrative of shape and naming
type RecordSurfaceSize = "sm" | "md" | "lg" | "xl" | "full";

export const RecordSurface = ({
  variant,                  // "dialog" | "drawer" | "page"
  size = "md",              // token → a class string merged through cn onto
                            //   DialogContent / SheetContent; zero generated-file edits
  title, description,       // the fixed header; title is a real heading in all three variants
  footer,                   // the fixed footer — a slot, not a fixed set of actions
  open, onOpenChange,       // the controlled mount; omitted for the routed, always-open mount
  dismissible = true,       // false refuses dismissal — Escape, overlay, close — while a mutation is in flight
  asChild,                  // the escape that lets a <form> BE the container's inner column
  children,                 // the scrolling body: overflow-y-auto min-h-0
}: RecordSurfaceProps) => …
```

- **The `<form>` wraps header, body and footer, and only the body scrolls.** This is what makes a `type="submit"` button work in a *fixed* footer and lets that footer read form state through context. It fights the primitives' own layout — `DialogContent` is `grid … gap-4 p-6`, `SheetContent` is `flex flex-col gap-4`, both laying out their direct children — so wrapping collapses them to a single child, and therefore **the form itself carries the row template, the `max-h` and the body's `min-h-0`**. The `asChild`/element escape exists for exactly this: a `<form>` can be the container's inner column while the container still owns the geometry classes.
- **The container is content-agnostic and the RHF frame renders inside it.** Container and form frame are fused today; split, the same surface serves a detail view, a confirmation with a long body, or a wizard, and `AppFormFrame` ([ADR-0035](0035-config-driven-resource-ui.md)'s one form frame) renders *inside* it. The behavioural halves stay in `apps/admin` as thin wrappers: the footer's `isPending`/`isDirty`/`isValid` reads through `useFormContext` in the app's wrapper, and the page variant's `useBlocker` (`enableBeforeUnload: false`) stays in the app's `AppFormPage` — a router hook has no business in a package whose shell "knows nothing about routing".
- **The container serves both mounts.** The routed mount is always-open and closing is a navigation; but three shipped, deliberately non-routed ceremonies — profile change-password and both administrative password resets — consume `AppFormDialog` directly with `open`/`onOpenChange` state. A container that assumed the routed contract would break all three; `open`/`onOpenChange` are therefore part of its API, defaulted for the routed case.
- **Sizes are a token set, not free values**: `sm | md | lg | xl | full`, mapped per variant to a class string and merged through `cn` onto `DialogContent`/`SheetContent` — both already merge `className`, so sizes cost **zero generated-file edits**. Any further generated-file edit carries the ADR-0031 comment naming the rule that forced it, per ADR-0047's carried rule.
- **Every [ADR-0044](0044-record-routes-without-list-state.md)/[0035](0035-config-driven-resource-ui.md) invariant carries over as this container's job**: the URL is identical across all three variants; closing is a navigation for the routed mount; an in-flight mutation refuses dismissal in all three shells (the `dismissible` flag is how the wrapper says so); and the title is a real heading in all three — the defect `D4.2` found by testing the shells against each other.
- **The structural pins hold**: the `dialog` variant keeps rendering a Radix Dialog (`role="dialog"`), the `drawer` variant a Sheet with `data-slot="sheet-content"`, and the `page` variant neither — the admin parity suite and the record-route suite name shells by exactly those, and they must keep passing unchanged.
- **`ConfirmDialog` does not adopt the container in D8.** It stays on `AlertDialog` — its own Radix root, no `showCloseButton` — and is named here as the future candidate for the container's "confirmation with a long body" case, decided when one exists rather than left to a step to discover.

### 5. Testing: geometry asserted in the package, behaviour asserted in the app

- **`@repo/ui`'s extended suite asserts roles, accessible names and `data-slot` presence only** — its harness is a `matchMedia` stub and Testing Library cleanup; no form, no router, no MSW. That is what "the gate is green with `@repo/ui`'s own suite extended" means and all it can mean.
- **The three-shell parity suite stays in `apps/admin` and is the `page` variant's exerciser.** It depends on `react-hook-form`, a real memory router and `@/test/render`, so it cannot follow the container into the package; extended to the new container it covers `dialog | drawer | page` without any shipped resource changing — no resource declares the page edit surface, and the suite is what keeps that variant from being the third unexercised surface.

## Consequences

- **Both SPAs get their frame from one package**, and D9's extraction stays mechanical: nothing behavioural moved, so its "no behaviour change" claim remains checkable by comparing test totals — minus the one-line file-count correction §Decision 1 charges.
- **Long forms keep their title and their Save button in every size token** — the defect that motivated the surface, closed structurally rather than per-screen.
- **The D6.3/D7.5 placement of theme and locale is reversed, on the record.** The account-menu *grouping* survives intact; its *mount* moves to `headerEnd`. Anyone reading D6.3's reasoning finds the counter-argument here rather than a silent contradiction.
- **Grid pages lose the duplicated `CardTitle`**, and the nine existing heading queries keep matching exactly one element; a page that reintroduces a second heading with the route's title breaks them, which is now a feature of the queries rather than an accident.
- **The slot-honesty rule is enforceable at review**: a slot justified by D11 must point at a sentence in `docs/plan/0011-customer-app.md`, added in the same change. Two shell slots (`banner`, `breadcrumbs`) and all three surface variants have named consumers today; `headerStart`/`headerEnd` are justified by the admin panel's own chrome.
- **Three coordinated edits per new package path** (exports entry, lint pattern, `shared/ui` re-export) are now a stated pattern with two precedents; forgetting the lint pattern is the failure mode to check for.
- **The banner region is D12-ready and D12-free**: the slot, the component and `dismissible` ship now; the principal field, the session plumbing and the `ImpersonationBanner` content remain D12's, and the no-`@repo/contracts`-import rule is the boundary a review can check.
- **`widgets/dashboard-layout` thins rather than disappears**, which keeps ADR-0032 unamended; the same holds for `shared/form`'s wrappers around the container.
- **What becomes harder**: the compositions are hand-maintained code in a package that was previously (almost) all generated — they are owned like `ui-strings.tsx`, with no upstream to diff against; and ADR-0031's upgrade-cadence coupling now covers layout, so a shell change is a both-apps change by construction, `"use client"` included.
- **Follow-ups owed to specific files**: the stale breadcrumb comment in `apps/admin/src/app/providers/ui-strings.tsx` (corrected by the first step that renders one); the D9 file-count line (corrected when D8's build order is written); the D11 requirement sentences (written with the slots that cite them).

## Alternatives considered

- **The compositions stay per-app and the customer app forks them.** The default under frozen ADR-0031, and the drift argument that created `@repo/ui` applies with more force to layout than to buttons: two shells diverge at the first app-local fix. Rejected because the second consumer's requirements are nameable now; the honest trade-off is that this is the divergence that forces ADR-0047 at all.
- **A separate compositions package (`@repo/layouts`).** Avoids superseding 0031 and was considered and rejected by the operator in favour of **one door per app** — a second package is a second exports map, a second lint pattern set and a second version to keep in step, bought only to keep a frozen record unedited, which is not what the supersession mechanism is for.
- **Two additive ADRs — one for the shell, one for the surface.** They share the packaging path, the strings mechanism, the testing split and the slot-honesty rule; splitting them would state each twice or cross-reference itself into one record anyway. One record, at the cost of length.
- **`react-hook-form` and `@tanstack/react-router` enter `@repo/ui` so the whole surface moves.** The reading D9's plan currently assumes. Rejected: it contradicts the shell's own no-routing rule, hands the design system a form engine ADR-0031 §Field-family deliberately kept it agnostic of, and couples both apps to two more heavy dependencies. The honest trade-off is that "one container, three variants" covers **geometry only**, the behavioural wrappers stay app-side, and D9's table takes its correction.
- **A submit button outside the form, carrying `form="<id>"`.** Avoids fighting the primitives' layout, and needs id plumbing through every surface while still leaving the footer outside the `useFormContext` it reads — the wrong half of the problem solved.
- **`Banner` on shadcn's alert primitive.** The package has no `alert` today; generating one only to compose over it puts the banner's base under the regenerate-and-diff rule for no upstream benefit, since the banner's shape (full-width, action slot, dismissible) is not the alert's. Hand-written, at the cost of owning its look outright.
- **The pseudo-locale notice gated on `config.VITE_I18N_PSEUDO` directly.** Renders in no test in the repository — the suite pins the variable to `"false"` on purpose — so the slot would be exercised only in a dev build. A prop with the env var as the app's default keeps the honest consumer honest.
- **ADR-0046 §13's `register(i18n)` for the compositions' strings.** The right mechanism for the packages D9 will extract, and the wrong one here: it gives `@repo/ui` the i18n dependency §12 forbids. `UiStrings` already exists, already reaches every generated primitive, and grows by one key per string.
- **Prove `headerEnd` by moving only `ThemeMenuItems`/`LocaleMenuItems`.** They are bare `DropdownMenuRadioGroup` fragments, mountable only inside a `DropdownMenuContent`; moving them alone means restructuring both features away from the radio-group semantics D6.3 chose. The whole `AccountMenu` moves instead — cheaper, and it keeps the D6.3 reasoning intact while reversing only the mount point.
- **The page header renders its own heading beside the shell's `<h1>`.** The obvious composition and a shipped bug: nine `getByRole("heading")` queries would match two elements and throw. One owner of the `<h1>`, decided once, and the grid pages' pseudo-title goes.
- **`ConfirmDialog` adopts the container now.** Uniform, and premature: `AlertDialog` is its own Radix root with its own dismissal semantics, no shipped confirmation has a long body, and adopting the container would be the third change to a working surface in one deliverable. Named as the candidate instead, so the next long confirmation re-reads this bullet rather than re-deriving it.
