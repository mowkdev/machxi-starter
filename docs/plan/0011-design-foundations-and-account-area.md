# D11 — Design foundations and account area

- Status: **planned** — opens when [D10](0010-grid-and-admin-followups.md) ships **and the design reference below is settled enough to extract decisions from**; **inserted 2026-08-29** ahead of the customer app (the D5 precedent — see `docs/plan/README.md` §How D11 was inserted), **fused with the design-foundations scope the same day** (the D8 precedent: one deliverable, one window, more than one record)
- Steps: written when the deliverable opens; this file carries scope, the decisions already taken, and the assumptions
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

**The reference is being extended, same language**: the account popover (ADR-0053's slimmed menu), the drawer and page edit surfaces were handed back to Claude Design 2026-08-30 with their baselines and a bound brief — the popover is a generated primitive, so its design must be expressible through tokens alone. **The sidebar footer's version string** is in scope as part of the shell redesign; the mechanism (a build-time constant — the root version and/or short commit hash via Vite `define`, never a runtime env var) is the design-language ADR's to fix, with the turbo-cache consequence weighed there.

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

## Acceptance sketch

The token sheet in `packages/ui` is the only place colors, radii and type scale changed, in both themes; the grid restyle lives in `@repo/grid` and the compositions only, with the generated primitives byte-identical to their CLI output; every structural adoption names its record (superseded or amended) and its updated e2e spec is green; the shipped screens match the canvas reference, operator-accepted. `/account` reachable from the account menu and from a cold URL; each section deep-linkable with its own title and breadcrumb; `/profile` redirects; theme and locale changed from `/account/preferences` persist through the same account-fact round trip D6/D7 proved (second browser finds the first one's choice); the account menu offers exactly the principal block, the account link and logout; the sidebar shows no account entry; every operator-facing string is a key in both catalogues; the layout composition is tested in `packages/ui` and its admin adoption in the app's tier; the account walk is a green `test:e2e` spec; the gate — including D10's `size` link — green, with the bundle budget as the check on what the redesign costs in bytes.
