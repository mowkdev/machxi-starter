# ADR-0053: The account area — `/account` with sections, and the menu slimmed

- Status: accepted
- Date: 2026-08-29
- Supersedes: [ADR-0045](0045-user-settings.md) (deltas: where the theme control renders; the settings core gains the density key)

> Written 2026-08-29 ahead of D11 ([`docs/plan/0011-design-foundations-and-account-area.md`](../plan/0011-design-foundations-and-account-area.md)), while D10 was still in progress — writing is not opening, the D4 precedent. **Revised 2026-08-30 while `proposed`** (the 0048 precedent): the design reference settled the density question as an account-held mode, and this record — the owner of the settings surface — takes it: §2's density paragraph, the second ADR-0045 delta, and the `/account/preferences` line below. **Accepted 2026-08-30 at the head of `D11.6`** — the density step, which is this record's first implementing step because it is the first one to build a decision of its own (§2's density key); the `/account` routes, the layout and the slimmed menu follow at `D11.8`–`D11.10`. ADR-0045 moved to `superseded by ADR-0053` in the same commit. Amendable in place while D11 is `in progress` (ADR-0025 rule 2). A delta supersession per [ADR-0050](0050-adr-lifecycle-and-verification.md): **everything ADR-0045 decided — the settings resource, both tables, the merge rules, the server adapter behind ADR-0041's seam, the coalescing writer, the adoption latch — stands as written and is in force as part of this record.** The one thing that changes is where the theme control renders.

## Context

The signed-in account's surfaces have accreted where each deliverable could put them: a flat `/profile` page (D3.9, ADR-0027's two-card split), a theme control in the account menu (D6.3, the ADR-0045 amendment this record supersedes on), and a locale switch beside it (D7.5). Each placement was right when made and the sum no longer is: the menu is a settings surface with no room to grow, `/profile` is one page that must eventually hold identity, credentials, sessions and an avatar, and the operator has asked for settings to live on a page. The customer app ([D12](../plan/0012-customer-app.md)) needs the same arrangement with different sections, which is the D8 second-consumer argument applied to a layout. The operator took the decisions below on 2026-08-29.

## Decision

### 1. One `/account` route family replaces `/profile`

```
/account              → layout route: section nav + content outlet; index redirects to profile
/account/profile      → identity: names, email, the summary; avatar when file storage is decided
/account/security     → the password card and dialog; sessions, 2FA, step-up when they exist
/account/preferences  → theme, locale and row density; later display state joins here
```

**The section rule, which answers placement questions this record cannot foresee: profile is who you are, security is how you prove it, preferences is how the app behaves for you.** It mirrors the API's own seam — the profile module against the ADR-0045 `settings` resource. Each section is a route: deep-linkable, carrying its own `staticData.title`, rendering ADR-0048 §2's breadcrumbs as `Account → <section>`. `/account` is under `_dashboard` so the guard is inherited; `/profile` becomes a redirect to `/account/profile` so nothing bookmarked breaks.

### 2. The quick controls move entirely, and the menu slims

`ThemeMenuItems` and `LocaleMenuItems` leave the account menu; **`/account/preferences` is the one inventory** — the same one-inventory argument ADR-0052 accepted for the applied-filters bar. The menu keeps the principal block, one link to the account area, and logout. Both controls keep their write paths unchanged: the theme writes both halves through the coalescing writer exactly as ADR-0045 decided, the locale through `useUpdateSettings` and the device key exactly as ADR-0046 §4 decided — the input surface moves, the state's path does not (the ADR-0052 columns-menu precedent).

The known cost is the wrong-language escape hatch: an operator stranded in a language they cannot read now travels through the menu and a section label. Two mitigations are part of this decision: the account entry and the preferences section carry **stable icons**, and **locale options are always self-named** (`English`, `Latviešu`) — never translated into the active locale.

**Row density joins the preferences as an account fact**: `gridDensity`, `"comfortable" | "compact"`, defaulting to comfortable — a key in ADR-0045's strict settings core, both segments, which is **this record's second 0045 delta**. **Amended 2026-08-30 (`D11.6`): it is a column and a migration, not "a jsonb value; no migration".** This sentence assumed a settings row had somewhere free-form to put a new fact, and it has not: `staff_settings` and `user_settings` carry `theme`, `locale` and `grids`, and `grids` is `Record<gridId, GridPreferencesV1>` — a per-grid map with no room for a row-wide mode, and widening it would put a reserved key in the one column ADR-0045 kept typed. So `gridDensity` lands the way `theme` and `locale` did: **one `as const` tuple in `@repo/contracts` feeding `pgEnum`, `z.enum` and the client union** (ADR-0023's one-declaration rule), a `grid_density` column on both tables defaulting to `comfortable`, and migration `0005_grid_density.sql`. The cost the original parenthesis was trying to avoid — a migration — is one `CREATE TYPE` and two `ADD COLUMN`s against a table nothing else reads; the cost it would have bought is a jsonb column meaning two different things. The decision itself is untouched: the fact is an account setting, on both segments, defaulting to comfortable. The Preferences section holds its card; a control in the grid's page-header band writes the same fact through ADR-0045's coalescing writer, exactly as the theme control does — two input surfaces, one account fact, one write path. What the two densities *are* — the row heights and paddings — is [ADR-0054](0054-design-language-instrument.md)'s to say.

### 3. The account area leaves the primary nav

The sidebar's `/profile` item retires; the sidebar is domain navigation and the account menu is the canonical way into the account area. This also removes the shipped double entry (sidebar item and menu item to one page). The `common:nav` key retires with it, in both catalogues, per ADR-0046's drift check.

### 4. `SettingsLayout` in `@repo/ui/src/compositions/`

The arrangement — a section nav beside a content pane, collapsing on small screens — is a hand-written composition under ADR-0047's compositions regime: presentation-only, **routing-ignorant**, no `@repo/contracts`. The nav arrives as **rendered children** (the app passes its own `<Link>`s with their active state), the same division `AppShell` uses for `navigating` and the sidebar. ADR-0048's slot-honesty rule is satisfied by name: the customer app is the second consumer, and its sections are already known to differ (delete-account under ADR-0028 in its security section), which is why the sections are the app's and only the geometry is shared. Its visual design is D11 phase 1's, on the same canvas as everything else.

**Amended 2026-08-30 (`D11.8`): the nav's accessible name arrives with the nav, as a required prop.** The division above sends the section links down as rendered children and stops there, which leaves the `<nav>` landmark this composition creates unnamed — and a page that already carries the shell's breadcrumb trail then offers a screen reader two identical entries. ADR-0046 §12's `UiStrings` seam is the wrong home for it: that seam carries the words the design system invents on its own behalf, each with an English default right in every consumer, and this name describes *the app's own set of sections* the way `AppShell`'s `title` describes the app's own screen. So it is a prop beside the nodes it names, required rather than defaulted, so no consumer can render the landmark anonymously by forgetting it. The geometry the composition ships with it is [ADR-0054](0054-design-language-instrument.md) §7's, amended at the same step.

### 5. Where the pieces live (FSD, per ADR-0049 as carried by 0051)

`entities/profile` and `features/profile-manage` are reused as they are across the `profile` and `security` sections. `features/theme` and `features/locale` trade menu items for page-form controls — a radio group over `THEMES`, a selection over `LOCALES` — with no change below the component layer. `pages/account` composes; the route files stay thin.

### 6. What this does to the other records

Only ADR-0045 takes deltas — two: its D6.3 amendment placed the theme control "in the account menu", which §2 replaces; and its settings core gains the `gridDensity` key, per §2's density paragraph. **ADR-0046 is untouched** — it decides where a locale comes from and how it is written, and its D7.5 amendment states it "says nothing about how an operator changes it"; the switch's menu seat was implementation, not a decision of that record. **ADR-0049 §The-shell-adapter (as carried by 0051) is untouched**: its decision is that the account menu lives in `headerEnd`, which stands; its list of the menu's contents is a description of the D8.5 move, not a decision — the ADR-0050 altitude rule, read in this record so the question is not reopened later.

## Consequences

- One place answers "my settings", and it grows by adding a route file — avatar, sessions and future preferences each have an obvious home before they exist.
- The menu becomes identity-and-exit; two clicks now stand between an operator and a locale change, paid for with the §2 mitigations.
- The customer app inherits the arrangement through `@repo/ui` and builds only its sections and links.
- **No new endpoint**, and one widened body. **Amended 2026-08-30 (`D11.6`): this bullet used to read "No API change".** The profile module, the password sub-resource and the settings resource carry everything the *area* reads and writes — no route is added, renamed or removed — but §2's density key is a field on both `PATCH /settings` bodies and on both resources, which is an API change however small. The plan said the same thing in the same breath and is amended with it (`docs/plan/0011-design-foundations-and-account-area.md` §What this deliverable is not).
- `/frontend-conventions`, the rule file and the resource-UI skill describe the account menu's contents and the nav items; the accepting step sweeps them.

## Alternatives considered

- **Keep quick controls in the menu beside the page.** One state, two surfaces — rejected by the operator for the same reason ADR-0052 retired chip suppression: an inventory with an exception is read twice.
- **Tabs held in component state on one page.** No deep links, no per-section titles, invisible to breadcrumbs and to the e2e walk. Rejected.
- **Two top-level pages (`/profile`, `/settings`).** The boundary blurs immediately — is language profile or settings? — and both need the same layout anyway. Rejected for the one area with a section rule.
- **A per-app settings layout, duplicated.** Cheaper today, paid again at D12 and diverging forever after. Rejected; geometry is exactly what ADR-0047 lets the apps share.
