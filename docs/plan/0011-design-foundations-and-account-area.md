# D11 — Design foundations and account area

- Status: **in progress** — **opened 2026-08-30**, the operator's decision, both opening conditions met: D10 shipped 2026-08-29 and the design reference is complete and accepted (§The reference settled). **Inserted 2026-08-29** ahead of the customer app (the D5 precedent — see `docs/plan/README.md` §How D11 was inserted), **fused with the design-foundations scope the same day** (the D8 precedent: one deliverable, one window, more than one record). The window covers [ADR-0053](../adr/0053-account-area.md) and [ADR-0054](../adr/0054-design-language-instrument.md), both `proposed` at opening — 0054 accepted at the head of `D11.1`, 0053 at the head of `D11.6`, each where its parents flip
- Steps: `D11.1` – `D11.11`
- Ledger: [`docs/plan/README.md`](README.md)

Scope, in two phases under one window: **first the design language lands** — the operator's redesign of the grid and the layouts, drawn in Claude Design against a canvas seeded from the shipped screens, applied through the token sheet, the compositions and `@repo/grid` — **then the account area is built in the new style**, never restyled after. Both phases land in the packages both apps consume, which is the whole reason this row sits where it does: the customer app ([D12](0012-customer-app.md)) inherits the design and the account layout by construction, through `@repo/ui` and `@repo/grid`, not by a second sweep.

## Phase 1 — design foundations

### The decisions taken 2026-08-29 (operator)

- **The redesign is structural, not only a re-skin.** In scope: the token sheet (colors, typography, radius, spacing/density — both themes together, they exist in pairs), the grid's visual chrome (header, rows, toolbar, pager, the D10 handle and stripes), **and** the arrangement questions — toolbar placement, the filter bar, page headers, density. That last clause is the expensive one and is chosen with its price known: structural changes walk into frozen territory — [ADR-0037](../adr/0037-grid-viewport-layout.md)'s height contract, [ADR-0048](../adr/0048-app-shell-and-record-surfaces.md)'s slot inventory as carried by [0052](../adr/0052-grid-and-admin-followups.md), the filter-bar decisions of [0039](../adr/0039-grid-filter-ux.md) as carried by 0052 — so each structural adoption is a supersession or an in-window delta **discovered at ADR-writing time**, and D10's `test:e2e` tier is the regression net that makes touching the height contract survivable.
- **The design work runs in parallel with D10, outside the repo.** The operator designs on the canvas; the repository's part starts when the reference is settled. Opening this deliverable before the reference exists would gate every step on an artefact still moving.
- **The canvas is seeded from reality** — artboards of the shipped grid page (light, and dark with stripes), the record-surface dialog, **the login screen**, the planned `/account` layout, and the token baseline sheet, drawn with the real current tokens — so every design change is a visible delta from what ships today, and D10's in-flight visual decisions (the at-rest resize handle, striped rows, the navigation progress bar) enter the canvas as inputs rather than casualties. **The canvas**: <https://claude.ai/code/artifact/eb88f288-daf8-4ed2-806b-933fdfb08279> (seeded 2026-08-29; the settled version of it is this deliverable's design reference). **The login is in scope as a layout** (added 2026-08-29): it renders outside the shell, so tokens restyle it for free and any structural change is designed explicitly — and its arrangement lives in the app's `widgets/auth-layout`, not in a `@repo/ui` composition, which makes it the one screen whose structural redesign edits app code rather than the three surfaces; whether that layout becomes a shared composition is [D12](0012-customer-app.md)'s finding to make, when a second app wants the same shape.

### The reference settled, 2026-08-30

The operator ran the handoff through Claude Design and accepted the result — **design language "Instrument"**: IBM Plex Sans/Mono, one cool hue family (258–264), radius base 6, a real dark theme (floor lifted off near-black, solid borders replacing alpha), band-structured chrome, and a written spec whose every value is `oklch`/px. **The reference of record is the Claude Design project** `3f8a12dc-1716-4f03-a3d4-6bc1b8ef1de5` (readable from this machine via the design login; `Tokens.dc.html` is the spec sheet, the screens beside it its proof), together with the seeded canvas as the before-state. It settles the density question the way §Decisions left open: **a mode** — Comfortable 44px default / Compact 34px, exactly three values apart — controlled from the grid header and mirrored in Account → Preferences.

**Six exclusions, accepted by the operator 2026-08-30** — the design invented features no record scoped, and they are not part of the reference: the login's "Forgot?" link (email reset is an unwritten ADR), the sidebar footer's health dot ("All systems normal" implies a poll — **the version string alone ships**), the sidebar nav count badge, "Disable account" in the record-dialog footer (stays a row action; its own decision if wanted), the session-TTL login copy, and sample filter/search content that implies fields `listQuerySchema` does not allow-list (chip styling applies; content follows what exists).

**One scope finding, recorded rather than smuggled**: the density mode is an account fact → a new key in the strict `settings` contracts schemas, both segments. That widens a contract, against this file's "No API change" assumption — see §What this deliverable is not, amended.

**The reference is complete — the round-2 extension returned and was accepted 2026-08-30**: the account popover (ADR-0053's slim contents, expressed entirely in token terms — 232px, item 32, hover `--accent`), and the drawer and page edit surfaces as visible siblings of the round-1 dialog (the same 60px title bar and 64px footer band, fields scrolling between; drawer 512px and page 672px unchanged). Every surface in this deliverable's scope now exists in Instrument, both themes. **One token addendum from round 2**: dark `--popover` splits from `--card` (`0.235` vs `0.215`) — a deliberate elevation rung, part of the reference. **Two adaptation notes for the applying step**, in the spirit of exclusion 6: the mock's `id 4187` subtitle adapts to what a record actually carries (ids here are UUIDs; the record label is the identity), and breadcrumbs follow D8.6's existing trail composition rather than the mock's `Navigation /` root. **The sidebar footer's version string** is in scope as part of the shell redesign; the mechanism (a build-time constant — the root version and/or short commit hash via Vite `define`, never a runtime env var) is the design-language ADR's to fix, with the turbo-cache consequence weighed there.

### The constraint the design must be expressed within

[ADR-0047](../adr/0047-ui-package-scope.md)'s byte-identical rule stands: the generated shadcn primitives in `packages/ui/src/components/` are not restyled file-by-file. The design speaks through exactly three surfaces — **the CSS token sheet** (`packages/ui/src/styles/globals.css`, Tailwind v4 CSS-first, both themes), **the hand-written compositions** (`AppShell`, `RecordSurface`, `Banner`, phase 2's `SettingsLayout`), and **`@repo/grid`'s own styling**. A design need that cannot be met from those three is either an owned-edit with its comment (ADR-0047 regime 1) or a finding for the ADR — named at the step, not smuggled in.

### How a settled design is applied exactly (the phase-1 method, decided 2026-08-29)

The canvas is not a picture — every artboard carries its styling as explicit values (`oklch(…)`, px, weights), which is what makes exact application a diff rather than an interpretation. The method:

1. **The diff is the spec.** The seeded canvas is the committed baseline and every Save keeps a version, so the settled design reads as _changes against what ships_. Extraction is per-value: each changed color, radius, size, weight and arrangement is named, not eyeballed. A designer (human or Claude Design) keeps this lossless by changing **values** on artboards rather than free-drawing over them.
2. **The design-language ADR is the record, not the image.** At `D11.1` the extracted values go into the ADR as tables — palette (both themes), radius, type, density, grid chrome — plus every structural adoption with the record it supersedes. From then on the ADR is what the code answers to; the canvas stays as its illustration.
3. **Application order follows the three surfaces**: the token sheet first (`globals.css`, both themes — everything on semantic tokens follows by construction), then chrome (`@repo/grid`, the compositions), then structural changes, each naming its record and updating its e2e spec in the same step.
4. **Exactness is checked at three levels, and only the first two are machine gates.** _Values_: the ADR's tables versus `globals.css` and the styled components is a reviewable diff — byte-comparable. _Structure_: the package suites assert the class strings and geometry (the D8 precedent), and `test:e2e` asserts the invariants. _Pixels_: Playwright screenshots of the shipped screens are put beside the artboards' PNG exports and **accepted by the operator** — an artboard and a browser render are never byte-identical (font rasterizing, antialiasing, real data), so automated pixel-diffing against artboards is deliberately not the gate; value equality plus a human look is.

### Decisions phase 1 needs

- **The design-language ADR**: the token contract as the redesign seam (what the palette, type scale, radius and density values are and where they live), the grid chrome decisions, and — separately stated — every structural adoption with the record it supersedes or amends. Expected to be the widest-reaching record of the deliverable; written when the canvas reference is settled.
- **Whether density becomes a mode or a decision.** A "density modes" control (comfortable/compact) is a preference (ADR-0041/0045 territory, a settings key) — a single chosen density is just tokens. The canvas decides which is wanted; the ADR prices it.

## Phase 2 — the account area

### The decisions taken 2026-08-29 (operator)

- **One `/account` area with child routes**, replacing the flat `/profile` page:

  ```
  /account              → layout: section nav + content outlet (index redirects to profile)
  /account/profile      → identity: names, email, the summary; avatar when file storage exists
  /account/security     → the password card and dialog today; sessions/devices, 2FA, step-up later
  /account/preferences  → theme and locale today; whatever display state comes later
  ```

  The section rule that answers future questions: **profile** is who you are, **security** is how you prove it, **preferences** is how the app behaves for you. It matches the API's own seam — the profile module vs the D6 `settings` resource — and each section being a route means deep links, per-route `staticData.title`, and D8.6's breadcrumbs (`Account → Security`) for free. `/profile` becomes a redirect so nothing bookmarked breaks.

- **The quick controls move entirely.** `ThemeMenuItems` and `LocaleMenuItems` leave the account menu; `/account/preferences` is the one inventory. The menu slims to the principal block, an account link and logout. The known cost is the wrong-language escape hatch the D7.5 comment recorded — an operator stranded in the wrong language now travels two clicks through copy they cannot read — and the mitigation belongs to the ADR: the preferences entry keeps a stable icon, and locale options are always self-named (`English`, `Latviešu`) so the destination is legible from any starting language.

- **The account area leaves the primary nav.** `/profile` is a sidebar item today; `/account` will not be — the sidebar stays domain (dashboard, staff, users) and the account menu is the canonical way in. This also retires the odd double-entry (sidebar item _and_ menu item pointing at the same page).

- **Delivered before the customer app.** Built after D10 so the account walk lands as a `test:e2e` spec from day one, and before D12 so the customer app consumes a proven layout the way it consumes the shell — the alternative was building the area twice, once per app.

### Decisions phase 2 needs

- **The account-area ADR is written**: [ADR-0053](../adr/0053-account-area.md), 2026-08-29, `proposed` — writing is not opening; accepted at the head of its first implementing step, where ADR-0045 moves to `superseded by`. The writing resolved the check this file had deferred, and narrower than assumed: **only [ADR-0045](../adr/0045-user-settings.md) takes a delta** (its `D6.3` amendment is the one record that places a control in the account menu). [ADR-0046](../adr/0046-interface-localization.md) is untouched — its own `D7.5` amendment says it decides where a locale comes from and "nothing about how an operator changes it", so the switch's menu seat was implementation, not a decision of that record. And [ADR-0049](../adr/0049-admin-app-architecture.md) §The-shell-adapter's menu enumeration (as carried by [0051](../adr/0051-platform-extraction.md)) is a description of the `D8.5` move, not a decision — the ADR-0050 altitude rule, read out explicitly in 0053 §6 so the question is not reopened later. Its index row waits with the renumber sweep, behind D10's in-flight window documents.
- **`SettingsLayout` (working name) in `@repo/ui/src/compositions/`** — the responsive two-pane arrangement: vertical section nav beside a content pane, collapsing on small screens, designed on the same canvas as everything else in phase 1. Per ADR-0047 it is geometry-only and **routing-ignorant**: the app passes its rendered `<Link>`s as the nav's children (the `AppShell` division — the shell never learned the router either). The slot-honesty rule of ADR-0048 is satisfied by name: the customer app is the second consumer, and its sections are already known to differ (its `security` gains delete-account per ADR-0028, its `preferences` may gain notification settings), which is exactly why the sections are the app's and only the arrangement is shared.
- **Where the section forms live in FSD terms**: `entities/profile` and `features/profile-manage` are reused as-is across `profile` and `security`; `features/theme` and `features/locale` trade their menu-item components for page-form controls (a radio group over `THEMES`, a select or radio over `LOCALES`), writing through exactly the paths they write today — `useTheme` and `useUpdateSettings` do not change. `pages/account` composes; the routes stay thin per ADR-0049.

## What this deliverable is not

- **No avatar.** It drags in file storage — upload, limits, serving — which the ADR index lists as an unwritten decision. The profile section renders complete without it indefinitely.
- **No API change** — amended 2026-08-30 by a finding, exactly as this bullet said it would be: no endpoint changes, but the **density mode adds one key to the strict `settings` contracts schemas** on both segments (jsonb value, no migration; the schema widening is the change). Everything else stands: `GET/PATCH /admin/profile`, the password sub-resource and the `settings` resource carry the rest.
- **No customer app work.** D12 consumes the design and the layout; nothing here imports from or anticipates `apps/customer` beyond the packages being app-agnostic.
- **No redesign of behaviour.** Filter semantics, selection, preferences, URL state and the record-route contract (ADRs 0038–0044) are untouched — this deliverable moves how things look and where chrome sits, not what anything does.

## Assumptions taken 2026-08-29 (revisable until the deliverable opens)

- **Phase order is strict**: tokens and chrome before the account area, so the area is built once, in the new style.
- **Structural changes update their e2e specs in the same step** — a spec that asserts the old arrangement is part of the change's diff, not a follow-up.
- **Visual acceptance is the operator's, against the canvas reference** — the e2e tier asserts structure and invariants, not aesthetics; "matches the design" is an operator-accepted item by construction.
- **Three account sections at v1.** The section _rule_ is the decision; the count is not. A future section is a new route file and a new nav link, no layout change.
- **The e2e walk grows by one account spec**, reusing D10's harness and its data rules (invariants, no counts, cleanup).
- **`nav.profile` copy and keys**: the `common:nav` key retires with the sidebar item; the account menu link's key moves from `account.profile` to whatever the ADR names the area. Both catalogues (`en`, `lv`) move in the same step, per ADR-0046's drift check.

## Build order

### ~~1. The records, the fonts and the token sheet~~ — **done 2026-08-30**

**ADRs:** [0054](../adr/0054-design-language-instrument.md) (accepted at the head of this step; 0037 moves to `superseded by 0054`, 0048 and 0052 gain their second-successor deltas), [0047](../adr/0047-ui-package-scope.md), [0026](../adr/0026-task-graph-caching-and-serialisation.md) as carried by 0052

Acceptance mechanics and the instruction-document sweep first (the window docs, the rule file, the skills that describe the gate and the design system). Then: `@fontsource` IBM Plex Sans + Mono into `apps/admin`, imported beside the stylesheet; `globals.css` rewritten to 0054 §2's tables, both themes, with `--font-sans`/`--font-mono` mapped in `@theme`; radius 6. The whole app re-skins from this step alone.

**Done when:** the values in `globals.css` match 0054 §2 as a reviewable diff; `pnpm test:e2e` green unchanged (a token re-skin moves no structure); the `size-budget.json` raise for the fonts is its own reviewed hunk; the gate green.

**Built 2026-08-30.** ADR-0054 accepted at the head, 0037 flipped, 0048 and 0052 given second-successor deltas, and the sweep run over eight documents (the ledger, this file, the ADR index, `CLAUDE.md`, `.claude/rules/frontend.md`, `/frontend-conventions`, `/ui-component`, the `ui-builder` agent). `@fontsource/ibm-plex-sans` 400/500/600 and `@fontsource/ibm-plex-mono` 400/500 imported in `apps/admin/src/app/index.tsx` beside `./styles.css`, whole faces rather than per-subset files — `@fontsource`'s `latin-400.css` carries no `unicode-range`, so importing two subsets makes the last one win for every character. `globals.css` rewritten to §2 with `--font-sans`/`--font-mono` in `@theme`. **Verified in Chrome, both themes**: `--background`, `--primary`, `--primary-tint`, `--border-strong`, `--success` and `--radius: 6px` computed exactly as §2 writes them, and `document.fonts.check('16px "IBM Plex Sans"')` true.

Three things this step found, none smuggled:

- **The focus ring's opacity is not reachable from the three surfaces**, so ADR-0054 §2 is amended to say what ships. Seven generated primitives spell it `ring-ring/50 ring-[3px]` and ADR-0047 keeps them byte-identical; the width matches the reference and the opacity is 50% of `--ring` rather than 20%/28%. The alternatives — an owned edit to seven files every regenerate would re-fight, or alpha inside `--ring`, which contradicts §2's own table row and dims every other consumer — both cost more than a focus ring's opacity is worth.
- **The radius _assignment_ is not the token sheet's to give**, and the review caught the record saying otherwise. The base and the 4·5·6·8 scale land here and are exact; which number a component takes is spelled in the component, and for the generated primitives that spelling is the CLI's — buttons, inputs and selects `rounded-md` (5, not 6), dialog `rounded-lg` (6, not 8), popover `rounded-md` (5, not 8), badge `rounded-full`, which §2's own "nothing rounder than 8" forbids. §2 is amended to route the assignment through the surfaces that own each shape — `@repo/grid`'s badges and chips at `D11.2`/`D11.4`, `RecordSurface` and the account control at `D11.5` — and to say that where only a primitive spells it, the primitive's value ships. §1 gained a second clause for the same class of honesty: **`apps/web` imports this sheet and loads no faces**, so the marketing site names IBM Plex and renders the fallback until D14 buys it its own bytes.
- **`test:e2e` failed once on leftover state, then passed twice.** `columns-menu.spec.ts` timed out on its Reset assertion because the dev account's stored column order was already non-default when the run started, so the `before` it captured was somebody else's arrangement and Reset could never equal it. Re-run alone: green in 1.9s. Full suite re-run: **14 passed**. Nothing in the diff touches drag, and the invariant the spec asserts is the ADR-0052 data rule it was written to obey — worth recording because the next reader of a red D11 e2e run should suspect the account before the code.

The budget's `css` link is the only one that moved: **12,598 → 14,042 gzipped bytes** — five `@fontsource` stylesheets carrying 28 `@font-face` rules, ~12.4 kB of very repetitive CSS — budget raised 14,000 → 15,600 to keep the file's own ~11% headroom. `js` moved 47 bytes and `entry` 2, which is what "a token re-skin ships no code" looks like from the outside. The woff2/woff files are emitted assets and are not counted: 28 of each ship and a browser downloads only the two or three subsets its text needs.

### ~~2. Grid chrome~~ — **done 2026-08-30**

**ADRs:** [0054](../adr/0054-design-language-instrument.md) §4, [0037](../adr/0037-grid-viewport-layout.md) as carried

In `@repo/grid`: the card frame retires (edge-to-edge, band rules), header 34px with caps labels, row/rule/stripe/selected/resize-tick values per §4, the status-dot renderer, mono on emails/timestamps/counts/role badges. Comfortable height only — density is `D11.6`'s.

**Done when:** the grid suites' updated structural assertions green; the e2e grid specs updated in this diff and green (header static, rows only scroller, no page-level horizontal scrollbar — same invariants, new values); the gate green.

**Built 2026-08-30.** The scroll pane lost `rounded-md border bg-card` — **the grid's own border box**, which is the frame §4 replaces with band rules — and keeps every ADR-0037 geometry class it had. Said exactly, because the review caught this note claiming more than the diff delivers: the _page's_ `Card` still wraps the pane on both grid screens, so the table is not yet edge-to-edge in the inset, and in dark the header's `--grid-header` (0.215) is the card's own lightness and therefore reads as no band at all. That is not a defect in this step's values — §4's numbers are written for a pane sitting on `--background` — it is the half of §4 that belongs to `D11.3`, where the page container grows its full-bleed variant and the pages adopt it. The band shows in light today and in both themes then. The header band is 34px on `--grid-header` with 11/16·600·0.07em caps labels and a `--border-strong` bottom rule; rows are 44px on `--grid-rule` with §3's 10px padding and 13/18 cells; the stripe, the selected row (`--primary-tint` plus a 2px inset bar) and the at-rest resize tick take §4's values. `StatusBadge` is a 6px dot beside its word — `--success` settled, `--warning` waiting, neutral otherwise — and role badges, emails, timestamps and the pager's range take the mono face. ADR-0037's own decisions are untouched: one scroll container, sticky header, static pager, separated borders, `min-h-64`.

Three things this step found:

- **Four of §4's values had no token to come from**, so they became four — `--grid-header`, `--grid-rule`, `--grid-stripe`, `--grid-tick` — in the sheet rather than `oklch()` literals in a component. §4 amended, labelled. The alternative was the defect the rule file names in the same sentence as the three surfaces.
- **"Emails take the mono face" is not something the grid may know.** A timestamp is derivable from its formatter; an address is domain knowledge, and `@repo/grid` holds none by ADR-0049. `ColumnConfig` grows one optional `mono` flag, resolved into the column meta once by `buildColumns` beside `align` and `structural`, and the two resource configs set it. §4 amended.
- **The dot retires the destructive status.** `disabled` had been rendering `destructive` since D3 — the palette's one alarm colour on a row's ordinary resting state — and §4 says neutral. Recorded in the ADR rather than left as a silent colour change.

**The selected row's 2px bar is drawn on the row's first cell, not on the `<tr>`.** The table is `border-separate` (ADR-0037's sticky-header bill from `D4.1`), and that model's promise about row-level borders is one a row-level `box-shadow` should not be trusted to keep either. The cell keeps it, and the ADR's value is unchanged.

Verification beyond the gate: `pnpm test:e2e` **16 passed**, with two new cases — one per grid — measuring the header at 34px, the row at 44px and the pane's computed border width and radius at zero, which is the only tier where a class string becomes a value. The first run of it was red on `columns-menu.spec.ts` in exactly the way `D11.1` recorded and told the next reader to expect: the dev account's stored column order was non-default when the run started, so Reset could never equal the `before` the spec captured. Re-run: green in 1.9s, full suite green. Nothing in this diff touches drag. The budget did not move enough to matter — css **14,042 → 14,352** gzipped bytes against the 15,600 `D11.1` left it at, which is four tokens and a handful of utilities.

### ~~3. Shell bands and the version footer~~ — **done 2026-08-30**

**ADRs:** [0054](../adr/0054-design-language-instrument.md) §5, [0048](../adr/0048-app-shell-and-record-surfaces.md) as carried, [0049](../adr/0049-admin-app-architecture.md)/[0051](../adr/0051-platform-extraction.md) for the widget seams

`AppShell`: header 56, the page-header band with the new `description` and `pageActions` slots, the full-bleed variant; the admin adapter and pages adopt. **The two grid pages' `Card` retires here** — `D11.2` retired the grid's own border box and left the page's, so until this step lands the table is not edge-to-edge and dark's `--grid-header` (0.215) is the card's own lightness; §4's grid values assume the pane sits on `--background`. `apps/admin`: sidebar 240, inset-bar active state, the 48px footer with the version constant (a tracked source + Vite `define`); breadcrumbs stay D8.6's composition.

**Done when:** the `@repo/ui` shell suite asserts the new slots render only when handed content; an admin test asserts the version constant renders from the tracked source; e2e shell specs updated in this diff and green; the gate green.

**Amended 2026-08-30 (`D11.3`).** The bullet above puts "sidebar 240" under `apps/admin`, and it is `AppShell`'s: the width is one custom property that the drawer's gap element and its fixed container both divide, and only `SidebarProvider`'s wrapper is an ancestor of both, so a value set in the app moves one and leaves the other reserving 16rem. It goes through the `style` the primitive already merges — ADR-0047 untouched. The nav item's inset bar and the footer are the app's, as written.

**Built 2026-08-30.** `AppShell`: header **56px** (`h-14`), the page-header band rebuilt around a 20/26·600 title with the two new slots — `description` (a `string`, rendering no element when absent) and `pageActions` (rendering no wrapper when absent) — the drawer set to **240px** on the provider, and the page container's **full-bleed variant**. `apps/admin`: the two grid pages' `Card` retired, the sidebar's active item drawn as a 2px inset `--primary` bar over `--primary-tint` instead of a grey pill, and `SidebarFooter` back with a 48px band holding the version alone. `@repo/grid`'s three chrome regions took the inset's gutter themselves (`px-4`), because a full-bleed container leaves each band to carry its own.

Measured in Chrome at 1440×900, both themes: header 56, drawer and gap both 240, the scroll pane's left edge at the inset's (240 = 240), the active item's computed shadow `oklch(0.52 0.14 258) 2px 0 0 inset` over `--primary-tint`, the footer reading `v0.0.0`, and the header band's ground `oklch(0.985 0.002 264)` in light — which is `D11.2`'s open item closing: with the page card gone, dark's `--grid-header` (0.215) now sits on `--background` (0.185) and reads as a band rather than as the card's own lightness.

Four things this step found, all recorded in ADR-0054 §5 rather than smuggled:

- **The full-bleed variant needs no flag of its own.** `fullHeight` selects it: a band layout and a height budget are the same category of page on every route in both apps, and a second always-equal boolean is the unexercised-slot defect in a different coat.
- **The description had to leave the page to reach the band.** It was a `CardDescription` inside each page; the band is above the page container, so it travels the channel the title travels — `staticData.description` and a `useRouteDescription` in `@repo/app-services`. **Which match it reads is `fullHeight`'s answer**, ADR-0048 §2's own discriminator: under the `page` surface the record replaced the list and the description comes from the match whose title won, so a record's heading carries no line rather than the list's sentence; under an overlay the list is still the screen and the deepest description wins. §5's mono count badge stays undrawn: nothing hands the shell a count, and that is the unexercised-slot defect from the other end.
- **`pageActions` lands in the package and not in the app.** The record names its consumer (`D11.6`'s density control), so the shell has the slot and its suite proves both directions; `dashboard-layout` does not grow the prop until something passes it.
- **The gutter that ships is 16px, not §3's 20.** §5's own "document pages keep the `p-4` gutter" governs, because the bands and the document pages have to agree — otherwise a title, a search box and a paragraph stop lining up as an operator moves between screens.

One shipped assertion changed rather than being deleted: `account-menu.test.tsx`'s "leaves no sidebar footer behind" was `D8.5`'s claim that the region went with the menu, and the region is back with a job. It narrows to what `D8.5` actually moved — the menu is not in the footer — which still guards the live failure of an account block finding its way back into the drawer.

Verification beyond the gate: `pnpm test:e2e` **19 passed**, three of them new — a `shell.spec.ts` measuring the 56px band, the 240px drawer _and its gap_ (two elements reading one property; a width set in the wrong place moves only one), the title and description in the band with the band outside `page-container`, and the version footer matching `/^v\d+\.\d+\.\d+$/` rather than the literal `undefined` a missing `define` produces — plus `grid-layout.spec.ts` gaining the edge-to-edge assertion `D11.2` said it could not yet make. Its first run was red twice: `columns-menu.spec.ts` in exactly the way `D11.1` recorded and told the next reader to expect (stored column order non-default at the start of the run; green alone in 1.9s and green in the full re-run), and `shell.spec.ts` measuring zeroes because it evaluated before the ADR-0033 boot gate had rendered anything — a spec bug, fixed in this diff by waiting on the `<h1>`. After the review's fixes one further full run was red and its artefacts were not captured; **the two full runs on either side of it were green at 19 passed**, and nothing since has reproduced it — recorded rather than tidied away, because the next reader of a red run on this tier should know it has flaked three times in one day and that `columns-menu.spec.ts`'s stored column order is the standing suspect. The budget moved by noise: js **+398**, css **+396** and entry **+79** gzipped bytes against `D11.1`'s baseline, all inside budgets with the headroom the file was given.

**The review found three, all fixed in this diff.** The one that mattered: `useRouteDescription` originally read only the match whose title won, and **both shipped resources render records as overlays** — so opening a row took the band's second line away while the grid was still mounted behind the dialog, handing nineteen pixels of `shrink-0` chrome to ADR-0037's budget on open and taking them back on close, twice per edit. The reader gained the `fullHeight` split above, ADR-0054 §5 gained the sentence, and `record-routes.test.tsx` gained the case that would have caught it — written on the record route, because the list case passes under either rule. Second: the active nav item's `data-[active=true]:text-foreground` names the global token inside a `<Sidebar>` whose scoped one is `--sidebar-foreground`; the two are the same value in both themes today, so it was a latent drift rather than a visible bug, and it is now `text-sidebar-foreground`. Third: ADR-0054 §Context enumerated the sanctioned surfaces as the three plus `auth-layout` "for the login's arrangement only", which §5 itself contradicts by putting the nav item and the footer in `apps/admin`'s shell widgets — amended in place, labelled, since the window is open.

The version's source is `apps/admin/package.json`'s `version`, read once in `apps/admin/app-version.ts` and installed as a `define` by **both** `vite.config.ts` and `vitest.config.ts` — Vitest reads only the latter, so a constant declared in one is a suite asserting a global the app does not ship. It sits inside the package, so `$TURBO_DEFAULT$` already makes a bump invalidate the `build` task with nothing added to `turbo.json`. **It reads `v0.0.0` today, which is true**: the blueprint has never cut a release, and ADR-0054's bump obligation is one line in that file when it does.

### ~~4. The toolbar, the segments and the Filtered-by band~~ — **done 2026-08-30**

**ADRs:** [0054](../adr/0054-design-language-instrument.md) §5, [0052](../adr/0052-grid-and-admin-followups.md) as carried (chip semantics untouched)

In `@repo/grid`: the 48px toolbar band (search 32, segmented hot filters 30), the 40px Filtered-by band (caps label, tinted 26px chips, underlined Clear all). Presentation only — one chip per filter, hot filters chipped, removal semantics and the live region exactly as shipped.

**Done when:** the applied-bar and hot-filter suites green with assertions updated to the new structure and none weakened on behaviour; e2e filter specs updated in this diff and green; the gate green.

**Amended 2026-08-30 (`D11.4`).** The bullet above names two of §5's three grid bands, and **the pager band has no step of its own** — `D11.2` was §4 (the table's own chrome) and `D11.3` was the shell's, so the 48px pager would have shipped as the one region of the stack still spaced and sized by the card era. It lands here: the three bands are one shape and have to agree, and a band whose height nobody owns is how a stack stops being a stack. §3's 30px pager controls come with it.

**Built 2026-08-30.** The toolbar band at **48px** with the search at 32 and §3's 13/18 control type; hot filters redrawn as a **30px segmented control** — a bordered track on `--muted` holding 26px segments, the pressed one on `--primary-tint` in `--primary`, which retires `D4.4`'s grey `bg-accent` pill and makes a pressed stance say the same thing its chip says; the **"Filtered by" band at 40px**, named in §3's 11/16·600·0.07em caps, holding 26px chips on `--primary-tint` at §2's `md` rung and an underlined Clear all; the **pager band at 48** with 30px controls; and the column's `gap-3` retired, because bands declare their own height and the twelve pixels between them were the card era's. **Presentation only, as the step says**: every behavioural assertion `D10.2` and ADR-0039 wrote — one chip per filter, hot filters chipped, the removal round trip, Clear all clearing `q` too, the live region mounted at zero — is untouched and still green beside the new ones.

Three things this step found, all recorded in ADR-0054 §5 rather than smuggled:

- **A band's height ships as a floor, not as a height.** All three wrap, and `flex-wrap` is what has kept a narrow viewport stacking them inside the frame since `D4.1`; a fixed `h-12` does not make a wrapping band shorter, it makes the second row spill out of it. So the record's 48 and 40 are `min-h-12`/`min-h-10`, they measure 48 and 40 wherever the reference draws them, and the split of labour is exact: the package suites assert the floor, the browser tier measures the number.
- **§3's 34px button is the page-header band's, not the toolbar's.** §5 assigns 34 where it names it — "icon buttons 34×34 and the primary" — and this band's own sentence names 32 and 30. The rest of the toolbar row is `Button size="sm"` at the CLI's 32, one of them the app's `createAction` arriving through a slot, so a 34 reachable only by overriding some of the row would buy the number with a row whose controls disagree with each other.
- **A presence stance is one segment and takes the track's height**, not a track of its own: a one-segment segmented control is a bordered button with an extra element around it, and the extra element is what a screen reader walks past to reach the only control inside.

Three mechanics worth the next reader's time, all cases of a generated primitive spelling a value the design also spells. The search's 13px is written `text-[13px] md:text-[13px]`, because `Input` spells its own size as `text-base md:text-sm` and an unprefixed override loses to the `md:` variant from 768px up — which is every viewport this band is drawn at. The rows-per-page trigger's 30 is written `data-[size=sm]:h-[30px]` for the sibling reason: `[data-size=sm]:h-8` is the more specific selector and `cn` cannot merge across modifiers, so a bare `h-[30px]` would have lost silently. Both are asserted as written, so the loss cannot come back unseen. The third was found in a browser rather than by reading, and only in dark: **`Button` spells part of every variant under `dark:`** — ghost's `dark:hover:bg-accent/50`, outline's `dark:bg-input/30 dark:hover:bg-input/50 dark:border-input` — and `cn` merges per modifier chain, so an unprefixed `bg-primary-tint` displaces none of them and loses the specificity contest to `.dark .x:hover` besides. A pressed segment turned grey under the pointer in dark, and a pressed presence stance showed no tint at all; every light-theme assertion was green throughout. The pressed state is now written with its `dark:` twins, and two cases assert them — one of them on a presence stance, which renders the `outline` variant that paints a ground even at rest.

**Measured in Chrome at 1440×900, both themes**: toolbar 48, "Filtered by" 40, pager 48, the seam between the scroll pane and the pager band 0, the search 32, the track 30 with its pressed segment at 26, the chip at 26 on a 5px radius, the caps label 11px/600/0.77px tracking (which is 0.07em at 11), Clear all underlined, and the pager's buttons and its rows-per-page trigger both 30 — with the pressed segment and the chip computing the _same_ `--primary-tint` in each theme, which is the point of drawing them in one colour.

Verification beyond the gate: `pnpm test:e2e` **21 passed**, two of them new — `grid-layout.spec.ts` measuring the toolbar and pager bands at 48 and the seam between the scroll pane and the pager at zero (a `gap` is a property of the column and shows on neither sibling, so it is measurable in no other tier), and `grid-state.spec.ts`'s filter walk measuring the "Filtered by" band at 40 and finding its caps label, on the one walk that has a filter applied. The first full run was red on `columns-menu.spec.ts` in exactly the way `D11.1` recorded and `D11.2` and `D11.3` repeated: green alone in 2.0s, and green in the two full re-runs after it — the last of them, after the review's fixes, at 21 passed with no retry. **That is four consecutive days of one spec flaking on stored column order and nothing else** — the standing suspect is the dev account's saved arrangement, and it belongs on `D11.11`'s close-out list rather than in another step's notes. The budget did not move: js **328.7 / 353.5**, css **14.2 / 15.2**, entry **252.5 / 273.4** kB gzipped, all ok.

**The review found five, all fixed in this diff, and two of them were values this note had claimed without the record's backing.** The segment's radius was the literal `rounded-[4px]` where the sheet already spells that rung as `--radius-sm` — exactly the "a value in a component is the defect" §2 states, and the doc comment beside it was already naming the token it was not using. The selection count had been moved to §3's 13 by analogy with the pager's range, and §3 puts "N selected" on the 12/16 **meta** rung, not the controls-and-data one; it is `text-xs`. The three judgement items: dropping `py-3` for a bare floor left the _wrapped_ case — the only case the floor exists for — with its rows flush against the band's edges, so all three bands carry padding that sits under their floor (`py-2`, `py-2`, `py-1.5`, re-measured at 48/40/48 in both themes); `data-slot="hot-filter"` names two shapes, the enum's track and the presence stance's own button, so the new track assertion is scoped to `[role="group"]` rather than trusting DOM order on `/users`, which declares both; and Clear all as a bare `h-auto` link was a ~19px pointer target, under WCAG 2.2's 24×24 for a standalone control, so it is `h-6`. **No ADR in this repo decides target size**, and this is not the step to invent one — recorded here as the operator's to make a standing rule if they want it.

One record gap closed on the way past: the ADR index's _Implemented_ column for 0054 stopped at `D11.2`, so **`D11.3`'s entry was written here beside `D11.4`'s**. `CLAUDE.md` rule 4 asks for the step in that column and the shell-bands step did not add one; a column that skips a step is worse than no column.

### 5. The record surfaces and the popover

**ADRs:** [0054](../adr/0054-design-language-instrument.md) §7, [0048](../adr/0048-app-shell-and-record-surfaces.md) as carried (variants, size tokens, heading rules)

`RecordSurface` and the form wrappers take the band anatomy (60/64), dialog 600, drawer static-band scrolling, page card 672 with the record-label `h1`; the account popover restyles through tokens alone — its diff must not touch `packages/ui/src/components/`.

**Done when:** the three-shell parity suite green under the new anatomy; `git diff` for `packages/ui/src/components/` empty in this step; e2e record-surface specs updated in this diff and green; the gate green.

### 6. Density

**ADRs:** [0053](../adr/0053-account-area.md) (accepted at the head of this step; 0045 moves to `superseded by 0053`), [0054](../adr/0054-design-language-instrument.md) §6, [0045](../adr/0045-user-settings.md) as carried

`gridDensity` into the settings core in `@repo/contracts` (both segments' strict bodies), the API accepting it with integration coverage, Postman touched per `/postman-sync`; `@repo/grid` takes the two-value density; the page-header control writes the account fact through the coalescing writer.

**Done when:** contracts and API integration tests green on the new key (both segments, reject-unknown still holding for anything else); a grid test asserts exactly row height, cell padding and badge padding change; an admin test asserts the control writes through settings; `pnpm test:postman` green; the gate green.

### 7. The login

**ADRs:** [0054](../adr/0054-design-language-instrument.md) §7 (the login block), [0046](../adr/0046-interface-localization.md)

`widgets/auth-layout` takes the 400px left-aligned composition on the hairline ground — the one screen whose structural redesign edits app code, as §The reference settled records. No "Forgot?" link, no TTL copy (§8 exclusions).

**Done when:** the login suite green under the new structure; the e2e sign-in spec green; every new string a key in `en` and `lv` with `pnpm i18n:check` clean; the gate green.

### 8. `SettingsLayout`

**ADRs:** [0053](../adr/0053-account-area.md), [0047](../adr/0047-ui-package-scope.md), [0054](../adr/0054-design-language-instrument.md) §7

The two-pane composition in `@repo/ui/src/compositions/` — routing-ignorant, nav as rendered children, responsive collapse — tested in the package.

**Done when:** its `packages/ui` suite green (nav children render, no router import — asserted by the package's dependency graph staying clean); `pnpm format:check` clean; the gate green.

### 9. `/account` — the routes, profile and security

**ADRs:** [0053](../adr/0053-account-area.md), [0049](../adr/0049-admin-app-architecture.md)/[0051](../adr/0051-platform-extraction.md), [0044](../adr/0044-record-routes-without-list-state.md)

The route family under `_dashboard` (layout, index redirect, three section routes), `/profile` redirecting; `pages/account` composes `SettingsLayout`; the profile summary + details form and the password card land in their sections, reusing `entities/profile` and `features/profile-manage` as they are.

**Done when:** routing tests assert each section deep-links with its own title and the redirect lands; the moved suites green in their new homes with no assertion weakened; the gate green.

### 10. Preferences, the slim menu and the nav

**ADRs:** [0053](../adr/0053-account-area.md), [0046](../adr/0046-interface-localization.md), [0042](../adr/0042-client-side-authorization.md) (the nav join it carries)

The Preferences section (theme cards, density cards, self-named language rows); `ThemeMenuItems`/`LocaleMenuItems` retire and the menu slims to principal block + Account + Sign out per the popover reference; the sidebar loses the Profile item and its `common:nav` key, both catalogues.

**Done when:** tests assert the theme, density and locale controls write through exactly the paths the menu items wrote; a menu test asserts exactly the three slim entries; `pnpm i18n:check` clean after the key moves; the gate green.

### 11. The account walk and close-out

**ADRs:** none of its own — the checklist below

The account e2e spec (menu → each section → theme/locale/density round trip, invariant-style per D10's data rules); then the §Definition-of-done run, the records sync, the ledger row.

**Done when:** every §Definition-of-done item is checked or recorded as pending operator acceptance; the row reads `shipped`; the window on 0053 and 0054 is shut.

## Definition of done

1. **The values are the reference's**: `globals.css` against 0054 §2, the chrome values against §4–§7 — reviewable diffs, no unexplained divergence.
2. **Structure is asserted**: every structural step's e2e specs updated in that step's diff and green; the package suites green; `git diff` for `packages/ui/src/components/` empty across the deliverable.
3. **The pixels are accepted by the operator**: Playwright screenshots of grid (both themes), record surfaces, login, popover and `/account` set beside the reference screens — value equality plus a human look, never an automated pixel diff.
4. **The account area behaves**: sections deep-link, `/profile` redirects, the round trip persists to a second browser, the menu holds exactly three entries, the sidebar holds no account entry.
5. **The contracts moved once**: `gridDensity` on both segments with integration and Postman coverage; nothing else in the API diff.
6. **Both catalogues complete**: `pnpm i18n:check` clean; the pseudo-locale suite green over the new routes.
7. **The gate keeps D10's shape**: `pnpm lint && pnpm check-types && pnpm test && pnpm size` green, `pnpm test:unit` twice with the second fully cached, `test:e2e` green beside; the budget raise for fonts reviewed, not silent.
8. **Records agree**: 0053 and 0054 `accepted` with labelled amendments; 0037 `superseded by 0054`; 0045 `superseded by 0053`; 0048 and 0052 carrying their second-successor deltas; the window documents in one reading pass.
