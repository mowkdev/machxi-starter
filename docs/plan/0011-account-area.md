# D11 — Account area

- Status: **planned** — opens when [D10](0010-grid-and-admin-followups.md) ships; **inserted 2026-08-29** ahead of the customer app (the D5 precedent — see `docs/plan/README.md` §How D11 was inserted)
- Steps: written when the deliverable opens; this file carries scope, the decisions already taken, and the assumptions
- Ledger: [`docs/plan/README.md`](README.md)

Scope: the signed-in account's own screens become an **area** rather than a page — `/account` with sectioned child routes — and the settings that live as menu items today (theme, locale) move into it. The admin panel builds it first, against its working test tier; the layout it is built from is designed for the customer app to consume at [D12](0012-customer-app.md), the same second-consumer argument D8 ran for the shell.

## The decisions taken 2026-08-29 (operator)

Recorded here at insertion; the ADR argues them properly when it is written.

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

- **Delivered before the customer app, as its own deliverable.** Built after D10 so the account walk lands as a `test:e2e` spec from day one, and before D12 so the customer app consumes a proven layout the way it consumes the shell — the alternative was building the area twice, once per app.

## Decisions this deliverable needs

- **One ADR — the account area** — deciding the route family, the section rule, and the menu slim-down. It **delta-supersedes two frozen records on placement only**: [ADR-0045](../adr/0045-user-settings.md), whose `D6.3` amendment put the theme control "in the account menu", and [ADR-0046](../adr/0046-interface-localization.md), which put the locale switch beside it (§4 / §10). Everything else in both stands — the settings resource, the coalescing writer, the adoption latch, the four-step locale precedence are all untouched; only where the controls render moves. At writing time, check whether the account-menu contents enumeration in [ADR-0049](../adr/0049-admin-app-architecture.md) §The-shell-adapter (as carried by [0051](../adr/0051-platform-extraction.md)) also needs a stated delta or merely a pointer.
- **`SettingsLayout` (working name) in `@repo/ui/src/compositions/`** — the responsive two-pane arrangement: vertical section nav beside a content pane, collapsing on small screens. Per [ADR-0047](../adr/0047-ui-package-scope.md) it is geometry-only and **routing-ignorant**: the app passes its rendered `<Link>`s as the nav's children (the `AppShell` division — the shell never learned the router either). The slot-honesty rule of [ADR-0048](../adr/0048-app-shell-and-record-surfaces.md) is satisfied by name: the customer app is the second consumer, and its sections are already known to differ (its `security` gains delete-account per ADR-0028, its `preferences` may gain notification settings), which is exactly why the sections are the app's and only the arrangement is shared.
- **Where the section forms live in FSD terms**: `entities/profile` and `features/profile-manage` are reused as-is across `profile` and `security`; `features/theme` and `features/locale` trade their menu-item components for page-form controls (a radio group over `THEMES`, a select or radio over `LOCALES`), writing through exactly the paths they write today — `useTheme` and `useUpdateSettings` do not change. `pages/account` composes; the routes stay thin per ADR-0049.

## What this deliverable is not

- **No avatar.** It drags in file storage — upload, limits, serving — which the ADR index lists as an unwritten decision. The profile section renders complete without it indefinitely.
- **No API change.** `GET/PATCH /admin/profile`, the password sub-resource and the `settings` resource already carry everything the area reads and writes. If a section turns out to need an endpoint, that is a finding at its step, not assumed scope.
- **No customer app work.** D12 consumes the layout; nothing here imports from or anticipates `apps/customer` beyond the composition being app-agnostic.

## Assumptions taken 2026-08-29 (revisable until the deliverable opens)

- **Three sections at v1.** The section _rule_ is the decision; the count is not. A future section is a new route file and a new nav link, no layout change.
- **The e2e walk grows by one spec**, not a new tier: sign-in → account menu → each section → change theme → change locale (and back) — reusing D10's Playwright harness and its data rules (invariants, no counts, cleanup).
- **`nav.profile` copy and keys**: the `common:nav` key retires with the sidebar item; the account menu link's key moves from `account.profile` to whatever the ADR names the area. Both catalogues (`en`, `lv`) move in the same step, per ADR-0046's drift check.

## Acceptance sketch

`/account` reachable from the account menu and from a cold URL; each section deep-linkable with its own title and breadcrumb; `/profile` redirects; theme and locale changed from `/account/preferences` persist through the same account-fact round trip D6/D7 proved (second browser finds the first one's choice); the account menu offers exactly the principal block, the account link and logout; the sidebar shows no account entry; every operator-facing string is a key in both catalogues; the layout composition is tested in `packages/ui` and its admin adoption in the app's tier; the account walk is a green `test:e2e` spec; the gate — including D10's `size` link — green.
