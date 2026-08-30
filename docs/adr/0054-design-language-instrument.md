# ADR-0054: Design language "Instrument" — tokens, band chrome, and the surfaces

- Status: accepted
- Date: 2026-08-30
- Supersedes: [ADR-0037](0037-grid-viewport-layout.md) (delta: the grid's visual frame); [ADR-0048](0048-app-shell-and-record-surfaces.md) (delta: the shell's chrome geometry — its second partial successor, beside [0052](0052-grid-and-admin-followups.md)'s); [ADR-0052](0052-grid-and-admin-followups.md) (delta: the applied-filters bar's presentation)

> Written 2026-08-30 for D11 ([`docs/plan/0011-design-foundations-and-account-area.md`](../plan/0011-design-foundations-and-account-area.md)). **Accepted 2026-08-30 at the head of `D11.1`**, where the three parents above moved in the same commit — [0037](0037-grid-viewport-layout.md) to `superseded by` outright, and [0048](0048-app-shell-and-record-surfaces.md) and [0052](0052-grid-and-admin-followups.md) to a **second** partial successor each (0048 already had 0052's; 0052 had none) — because that step's instruction-document sweep states those supersessions in the same sentences (the `D8.1` precedent); amendable in place while D11 is `in progress` (ADR-0025 rule 2). Delta supersessions per [ADR-0050](0050-adr-lifecycle-and-verification.md): **everything each parent decided that is not named below stands as written** — ADR-0037's height budget, one scroll container, sticky header, static pager and per-page `fullHeight` opt-in; ADR-0048's slots, size tokens, form-wrapping inversion and heading rules; ADR-0052's chip semantics, Clear-all, `navigating`, the e2e tier and the budget. This record's authority for its values is the operator-accepted reference: Claude Design project `3f8a12dc-1716-4f03-a3d4-6bc1b8ef1de5`, whose `Tokens.dc.html` is the value spec and whose screens are its proof, read together with the plan's recorded exclusions and adaptation notes.

## Context

The panel shipped on stock shadcn neutral — competent and characterless. The operator commissioned a structural redesign through Claude Design against a canvas seeded from the shipped code; the result — one cool hue family, IBM Plex, band-structured chrome — came back as per-value tables and was accepted 2026-08-30 with six exclusions (plan §The reference settled). This record transcribes the decisions; the reference stays the illustration. Everything lands through the sanctioned surfaces: the token sheet, the `@repo/ui` compositions, `@repo/grid` chrome — plus `apps/admin`'s `auth-layout` for the login's arrangement only. **Amended 2026-08-30 (`D11.3`): "for the login's arrangement only" is too narrow, and §5 says so itself.** The active nav item and the sidebar's version footer are decided in §5 and live in `apps/admin`'s `widgets/app-sidebar`, because the drawer's *contents* are the app's by [ADR-0049](0049-admin-app-architecture.md) §The-shell-adapter while its geometry is the composition's. So the fourth surface is **the app's own shell widgets and `auth-layout`**, for what those layers already own — still never a generated primitive, and still every colour from a token. Generated primitives stay byte-identical (ADR-0047); the popover's design is expressible through tokens alone by construction.

## Decision

### 1. Fonts

**IBM Plex Sans** (400/500/600) for UI; **IBM Plex Mono** (400/500) for identifiers, emails, timestamps and counts. **Self-hosted via `@fontsource` packages, imported by each app beside the stylesheet** — not Google's CDN: an EU-facing product does not send visitor IPs to a third party to render text, dev and e2e run offline, and the bundle budget prices the bytes honestly. Fallback stacks: the current system-ui stack for sans; `ui-monospace, SFMono-Regular, Menlo, monospace` for mono. `@theme` maps `--font-sans`/`--font-mono`. **Amended 2026-08-30 (`D11.1`): the sheet names the faces, each app loads its own bytes.** `--font-sans`/`--font-mono` live in `@repo/ui`'s token sheet, because the design system owns what the design *is*; the `@fontsource` imports are per-app, beside that app's stylesheet. `apps/admin` loads them here. **`apps/web` imports the same sheet and does not load them**, so the marketing site names IBM Plex and renders the fallback stack until D14 gives it its own imports — deliberate, not an oversight: it is a Next.js app of its own build shape, and D14 is where its bytes are priced.

### 2. Tokens (`globals.css`, both themes)

Every neutral and the primary sit on hue 258–264; neutral chroma ≤ 0.014. `--radius: 6px` (sm 4 · md 5 · lg 6 · xl 8 — checkbox / badge·chip / controls / card·dialog·popover; nothing rounder than 8). **Amended 2026-08-30 (`D11.1`): the base and the scale ship here; the per-component assignment is each surface's own step.** The four numbers are the token sheet's and land whole, but *which* number a component takes is spelled in the component, and for the generated primitives that spelling is the CLI's and byte-identical under ADR-0047 — buttons, inputs and selects are `rounded-md` (5, not the assignment's 6), the dialog `rounded-lg` (6, not 8), the popover `rounded-md` (5, not 8) and the badge `rounded-full`, which this sentence's own "nothing rounder than 8" forbids. Only `Card` (`rounded-xl` = 8) and `Checkbox` (a literal `rounded-[4px]`) already agree. **The assignment is reached from the sanctioned surfaces that own each shape, in the step that owns it** — §4's badges and chips in `@repo/grid` at `D11.2`/`D11.4`, §7's dialog, drawer, page card and popover through `RecordSurface` and the account control at `D11.5`. Where *only* a generated primitive spells the radius, the primitive's value ships, on the same terms as the focus ring below. Focus ring 3px at 20% light / 28% dark of `--ring` (= primary). **Amended 2026-08-30 (`D11.1`): the width ships, the opacity does not.** Seven generated primitives spell the ring `ring-ring/50 ring-[3px]`, and ADR-0047 keeps `packages/ui/src/components/` byte-identical to the CLI output, so the only way to 20%/28% is either an owned edit to seven files that every regenerate would re-fight, or putting the alpha into `--ring` itself — which contradicts the table row above and would dim every other consumer of the token. Neither is worth a focus ring's opacity. **What ships is 3px at 50% of `--ring`**, and this record says so rather than leaving the code quietly disagreeing with it; the reference's value is recoverable the day a supersession has a better reason to reach those files.

| Token                    | Light                       | Dark                        |
| ------------------------ | --------------------------- | --------------------------- |
| `--background`           | `oklch(0.99 0.002 264)`     | `oklch(0.185 0.008 264)`    |
| `--foreground`           | `oklch(0.18 0.008 264)`     | `oklch(0.965 0.003 264)`    |
| `--card`                 | `oklch(1 0 0)`              | `oklch(0.215 0.008 264)`    |
| `--popover`              | `oklch(1 0 0)`              | `oklch(0.235 0.008 264)`    |
| `--primary`              | `oklch(0.52 0.14 258)`      | `oklch(0.7 0.13 262)`       |
| `--primary-foreground`   | `oklch(0.99 0.002 264)`     | `oklch(0.16 0.02 264)`      |
| `--primary-tint` (new)   | `oklch(0.52 0.14 258 / 8%)` | `oklch(0.7 0.13 262 / 16%)` |
| `--secondary`            | `oklch(0.955 0.003 264)`    | `oklch(0.27 0.008 264)`     |
| `--secondary-foreground` | `oklch(0.28 0.012 264)`     | `oklch(0.93 0.004 264)`     |
| `--muted`                | `oklch(0.975 0.003 264)`    | `oklch(0.205 0.008 264)`    |
| `--muted-foreground`     | `oklch(0.5 0.012 264)`      | `oklch(0.7 0.008 264)`      |
| `--accent`               | `oklch(0.93 0.005 264)`     | `oklch(0.28 0.008 264)`     |
| `--accent-foreground`    | `oklch(0.2 0.01 264)`       | `oklch(0.96 0.003 264)`     |
| `--destructive`          | `oklch(0.52 0.19 25)`       | `oklch(0.7 0.16 25)`        |
| `--border` · `--input`   | `oklch(0.905 0.005 264)`    | `oklch(0.3 0.008 264)` (input `0.31`) |
| `--border-strong` (new)  | `oklch(0.86 0.005 264)`     | `oklch(0.33 0.008 264)`     |
| `--ring`                 | `oklch(0.52 0.14 258)`      | `oklch(0.7 0.13 262)`       |
| `--sidebar`              | `oklch(0.975 0.003 264)`    | `oklch(0.165 0.008 264)`    |
| `--sidebar-accent`       | `oklch(0.93 0.005 264)`     | `oklch(0.25 0.008 264)`     |
| `--success` (new)        | `oklch(0.58 0.13 155)`      | `oklch(0.72 0.14 155)`      |
| `--warning` (new)        | `oklch(0.7 0.14 75)`        | `oklch(0.82 0.15 78)`       |

Dark borders are **solid, not alpha** — a border reads the same over any surface. Dark's floor is lifted off near-black so sidebar (0.165) < background (0.185) < muted (0.205) < card (0.215) < popover (0.235) is a readable elevation ramp.

### 3. Type, controls, spacing

Type: 11/16·600·0.07em caps (column heads, group labels) · 12/16 (chips, badges, meta) · 13/18 (controls, cells, mono data) · 14/20 (body) · 16/22·600 (card/dialog titles) · 20/26·600 (page title) · 28/34·600 (login). Control heights (border-box): 26 chip/badge · 30 pager, quick-filter segment · 32 toolbar search · 34 buttons and icon buttons · 36 form inputs · 38 login controls · 44 settings option row. Spacing base 2px: 6 label→control · 8 controls-in-row · 10 cell padding, nav gap · 16 card stack · 20 page gutter, card padding · 24 dialog padding.

### 4. Grid chrome (`@repo/grid`) — the ADR-0037 delta

**The card frame retires: the table is edge-to-edge inside the inset**, bounded by band rules (`--border-strong` closes the chrome above it) instead of a border box — the scroll container, sticky header and static pager are untouched. Header row 34px, caps labels, header bg `0.985`/`0.215`, bottom rule `--border-strong`. Rows 44px (Comfortable) / 34px (Compact — see §6), rule `0.93`/`0.24`. Stripe (opt-in) `0.978`/`0.203`. Selected row: `--primary-tint` + `inset 2px 0 0 --primary`. Resize tick at rest 1×16px `0.9`/`0.36`. Statuses render as a 6px dot (`--success` active, `--warning` invited, neutral disabled) beside the label — the same resource-agnostic renderer, re-drawn. Emails, timestamps, counts and role badges take the mono face.

**Amended 2026-08-30 (`D11.2`): the four chrome lightnesses above ship as named tokens, and "which column is data" is the config's answer.** Two things the applying step found, neither smuggled.

_The values need tokens._ The header ground, the row rule, the stripe and the tick are the only values in this record that **no palette token carries** — `0.985` sits between `--background` and `--muted`, `0.93` is lighter than `--border` in light and `0.24` darker than it in dark, and the tick wants to be *lighter* than the rule in dark so a 1px grip stays findable. §2's own rule is that a colour in a component is the defect, so they land in the token sheet as `--grid-header`, `--grid-rule`, `--grid-stripe` and `--grid-tick`, each taking the chroma of the token it sits beside so the hue family and the ≤ 0.014 neutral ceiling still hold. The sheet is one of the three sanctioned surfaces; this is it being used rather than worked around.

_"Emails take the mono face" is not derivable in the grid._ A timestamp is — the formatter says so — but `@repo/grid` may hold no domain knowledge (ADR-0049), and *this column holds an address* is domain knowledge. So `ColumnConfig` grows one optional serializable flag, `mono`, resolved into the column meta once by `buildColumns` the way `align` and `structural` already are; the resources set it on their email and timestamp columns. It is config vocabulary growing, not a decision changing, and it keeps a per-usage override able to turn it off.

One consequence stated because it is a visible change of behaviour rather than of value: **the status renderer's negative list retires with the badge.** `disabled` rendered `destructive` — the palette's one alarm colour spent on a row's ordinary resting state — and "neutral disabled" above is what ships. Destructive stays for actions that destroy something.

### 5. Band chrome and the shell — the ADR-0048 delta

The inset is a stack of full-width bands: **header 56px** (breadcrumb left, account control right — a 40px bordered control with a 26px tinted monogram) · **page-header band** (20/26 title + mono count badge + 13px description left; actions right — icon buttons 34×34 and the primary; `AppShell` gains the width for this: a `description` and a `pageActions` slot, the need ADR-0048 said would name them) · **toolbar band 48px** and **"Filtered by" band 40px** (the grid page's, see below) · **pager band 48px**. The page container gains a **full-bleed variant** for band layouts; document pages keep the `p-4` gutter. Sidebar 240px; the active nav item is a 2px inset `--primary` bar over `--primary-tint`, not a grey pill; **the sidebar gains a 48px footer holding the version string alone** (mono, right-aligned) — a **build-time constant from a deliberately-bumped tracked source via Vite `define`**, never a runtime env var and never an uncached git SHA (a cached build must not lie about its version). Hot filters render as a 30px **segmented control**; the applied-filters bar becomes the **"Filtered by" band** — caps label, 26px `--primary-tint` chips, underlined Clear all — presentation only: one chip per filter, hot filters chipped, removal and the live region exactly as ADR-0052 decided (**that is this record's 0052 delta — nothing behavioural moves**).

**Amended 2026-08-30 (`D11.3`): the four switches this section left implicit are named, and one number yields to another this section already wrote.** The step that built the bands found each of them, and none is a change of value.

_The full-bleed variant has no flag of its own; `fullHeight` selects it._ A second boolean would be `true` on exactly the routes that already declare ADR-0037's opt-in and `false` on the rest, in both apps — a band layout and a height budget are the same category of page — and an always-equal prop is the slot-with-no-consumer defect ADR-0048 §2 spends a paragraph on. The day a screen wants one without the other is the day it splits, with a consumer to name.

_The description travels on the route, not in the page._ The band's second line is per-screen copy, so it rides the channel the title rides: the shells' route-meta reader (`@repo/app-services`) grows a `description?: TranslationKey` in `staticData` and a `useRouteDescription` beside `useRouteTitle`. **Which match it reads is `fullHeight`'s answer, which is ADR-0048 §2's own discriminator rather than a new one.** Under the `page` surface (`fullHeight` false) the record replaced the list, so the description comes from the match whose *title* won — that route declares none, and a record's heading carries no line rather than the list's sentence under the record's name. Under an overlay, and on an ordinary list (`fullHeight` true), the list is still the screen and the grid is still mounted behind the modal, so the deepest *description* wins and the band does not move. The second half is the step's review finding: coupled to the title alone, opening a row on either shipped resource — both overlays — took nineteen pixels of band away and handed them to the grid behind the dialog, twice per edit. The alternative, leaving the description in each page, would put it below the `<h1>` in the page container instead of beside it in the band, which is not what this section draws. **The mono count badge stays undrawn**: nothing hands `AppShell` a count today, and a slot with no consumer is the defect above. It costs one prop when a screen names it.

_`pageActions` lands in the package and not yet in the app._ The shell has the slot, because this section names its consumer — `D11.6`'s 34×34 density control — but `apps/admin`'s adapter does not grow the prop until something passes it. The package's own suite proves both directions; the app's chain stays honest.

_The sidebar's 240px is the composition's, not the app's._ The width is one custom property that two sibling elements divide — the gap that reserves the column and the fixed container that fills it — and only `SidebarProvider`'s wrapper is an ancestor of both. A consumer setting it on its own `<Sidebar>` moves the drawer and leaves a 16rem hole behind it. `AppShell` sets it through the `style` the primitive already merges, so ADR-0047's byte-identical rule is untouched.

_And the gutter that ships is 16px, not §3's 20._ §5's own sentence — "document pages keep the `p-4` gutter" — is the one that governs, because the two must agree: the header and page-header bands, the grid's toolbar, filter and pager bands, and every document page's container now inset by the same 16px, so a title, a search box and a paragraph line up down the left edge whichever layout a screen is. Giving the bands 20 and the document pages 16 would have been the reference's number bought with a visible misalignment between screens.

### 6. Density

Two numbers, not a scale: **Comfortable 44px (default) / Compact 34px**, differing in exactly row height, cell padding (10→8) and badge padding. A 34×34 icon control in the page-header band switches it; **the fact is an account setting** — the key, its schema and its Preferences card belong to [ADR-0053](0053-account-area.md), which owns the settings surface.

### 7. The other surfaces

Record container, all three variants as siblings: 60px title bar (16/22 title + 12px meta line), 24px body padding with a 20px field stack, **64px footer band** (`--muted` bg, top rule) holding Cancel + primary; dialog 600px, drawer 512px full-height with the body scrolling between static bands, page card 672px with the record label as the page's one `h1`. Popover: 232px, 4px padding, radius 8, 32px items, hover `--accent` — tokens only. Login (in `apps/admin`'s `auth-layout`): a left-aligned 400px column — brand line, 28/34 heading, an 8px-radius card with 38px controls — on a 48px hairline-grid ground; same values both themes.

### 8. Not adopted

The reference's inventions stay out, as the plan records: no login "Forgot?" link, no health dot, no nav count badges, no destructive actions in surface footers, no session-TTL copy, and mock content (sample filters, numeric ids, the `Navigation /` crumb root) yields to what the contracts and D8.6's trail actually provide.

## Consequences

- Practically every screen's diff is a token diff; the structural steps are the ones that touch layout code, and each updates its e2e specs in the same diff.
- The bundle budget prices the fonts and the redesign in bytes; raising `size-budget.json` is a reviewed diff.
- The version footer creates the bump obligation: a release habit of one line, or the footer lies.
- The customer app (D12) inherits all of it through the packages.

## Alternatives considered

- **Stay on shadcn neutral.** Zero cost, zero identity; rejected by the operator with the redesign commission itself.
- **Google Fonts CDN.** Simpler; rejected — third-party requests from an EU-facing product, an external runtime dependency, and offline dev/e2e breakage.
- **Git SHA as the footer version.** Always truthful at build time, wrong from a warm cache, and cache-busting if made an input; rejected as primary.
- **A density scale (3+ steps or free value).** More knobs than the two jobs found in use; rejected for two named numbers.
