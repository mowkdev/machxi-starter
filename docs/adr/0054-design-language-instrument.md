# ADR-0054: Design language "Instrument" — tokens, band chrome, and the surfaces

- Status: proposed
- Date: 2026-08-30
- Supersedes: [ADR-0037](0037-grid-viewport-layout.md) (delta: the grid's visual frame); [ADR-0048](0048-app-shell-and-record-surfaces.md) (delta: the shell's chrome geometry — its second partial successor, beside [0052](0052-grid-and-admin-followups.md)'s); [ADR-0052](0052-grid-and-admin-followups.md) (delta: the applied-filters bar's presentation)

> Written 2026-08-30 for D11 ([`docs/plan/0011-design-foundations-and-account-area.md`](../plan/0011-design-foundations-and-account-area.md)). Accepted at the head of `D11.1`, where the three parents above gain the deltas; amendable in place while D11 is `in progress` (ADR-0025 rule 2). Delta supersessions per [ADR-0050](0050-adr-lifecycle-and-verification.md): **everything each parent decided that is not named below stands as written** — ADR-0037's height budget, one scroll container, sticky header, static pager and per-page `fullHeight` opt-in; ADR-0048's slots, size tokens, form-wrapping inversion and heading rules; ADR-0052's chip semantics, Clear-all, `navigating`, the e2e tier and the budget. This record's authority for its values is the operator-accepted reference: Claude Design project `3f8a12dc-1716-4f03-a3d4-6bc1b8ef1de5`, whose `Tokens.dc.html` is the value spec and whose screens are its proof, read together with the plan's recorded exclusions and adaptation notes.

## Context

The panel shipped on stock shadcn neutral — competent and characterless. The operator commissioned a structural redesign through Claude Design against a canvas seeded from the shipped code; the result — one cool hue family, IBM Plex, band-structured chrome — came back as per-value tables and was accepted 2026-08-30 with six exclusions (plan §The reference settled). This record transcribes the decisions; the reference stays the illustration. Everything lands through the sanctioned surfaces: the token sheet, the `@repo/ui` compositions, `@repo/grid` chrome — plus `apps/admin`'s `auth-layout` for the login's arrangement only. Generated primitives stay byte-identical (ADR-0047); the popover's design is expressible through tokens alone by construction.

## Decision

### 1. Fonts

**IBM Plex Sans** (400/500/600) for UI; **IBM Plex Mono** (400/500) for identifiers, emails, timestamps and counts. **Self-hosted via `@fontsource` packages, imported by each app beside the stylesheet** — not Google's CDN: an EU-facing product does not send visitor IPs to a third party to render text, dev and e2e run offline, and the bundle budget prices the bytes honestly. Fallback stacks: the current system-ui stack for sans; `ui-monospace, SFMono-Regular, Menlo, monospace` for mono. `@theme` maps `--font-sans`/`--font-mono`.

### 2. Tokens (`globals.css`, both themes)

Every neutral and the primary sit on hue 258–264; neutral chroma ≤ 0.014. `--radius: 6px` (sm 4 · md 5 · lg 6 · xl 8 — checkbox / badge·chip / controls / card·dialog·popover; nothing rounder than 8). Focus ring 3px at 20% light / 28% dark of `--ring` (= primary).

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

### 5. Band chrome and the shell — the ADR-0048 delta

The inset is a stack of full-width bands: **header 56px** (breadcrumb left, account control right — a 40px bordered control with a 26px tinted monogram) · **page-header band** (20/26 title + mono count badge + 13px description left; actions right — icon buttons 34×34 and the primary; `AppShell` gains the width for this: a `description` and a `pageActions` slot, the need ADR-0048 said would name them) · **toolbar band 48px** and **"Filtered by" band 40px** (the grid page's, see below) · **pager band 48px**. The page container gains a **full-bleed variant** for band layouts; document pages keep the `p-4` gutter. Sidebar 240px; the active nav item is a 2px inset `--primary` bar over `--primary-tint`, not a grey pill; **the sidebar gains a 48px footer holding the version string alone** (mono, right-aligned) — a **build-time constant from a deliberately-bumped tracked source via Vite `define`**, never a runtime env var and never an uncached git SHA (a cached build must not lie about its version). Hot filters render as a 30px **segmented control**; the applied-filters bar becomes the **"Filtered by" band** — caps label, 26px `--primary-tint` chips, underlined Clear all — presentation only: one chip per filter, hot filters chipped, removal and the live region exactly as ADR-0052 decided (**that is this record's 0052 delta — nothing behavioural moves**).

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
