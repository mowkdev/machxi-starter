# D12 — Customer app

> **Renumbered from D11 on 2026-08-29**, when the design foundations and account area ([D11](0011-design-foundations-and-account-area.md)) were inserted ahead of it — a ledger decision, the D5 precedent; see `docs/plan/README.md` §How D11 was inserted.

- Status: **in progress** — **opened 2026-08-31**, the operator's decision, the day D11 shipped. The window covers [ADR-0055](../adr/0055-customer-app.md), `proposed` at opening and **accepted 2026-08-31 at the head of `D12.1`**, where [ADR-0022](../adr/0022-frontend-apps.md) moved to `superseded by` (a delta: the roster; every stack decision stands)
- Steps: `D12.1` – `D12.11`
- Ledger: [`docs/plan/README.md`](README.md)

Scope: **`apps/customer`** — a Vite + React SPA over the `/user` segment, dev port 3002, the same shape as `apps/admin` — built as the **second consumer** of the shell, surfaces, machinery and design language that D8–D11 designed, extracted and settled. It ships self-service v1: sign-in on the ADR-0033 session model, profile, credential self-service ([ADR-0027](../adr/0027-credential-self-service-and-reset.md)'s rules with the account as actor), settings (D6, density included), and account deletion ([ADR-0028](../adr/0028-account-deletion.md)'s user semantics, self-served), localized in `en` and `lv` from the first screen and drawn in Instrument ([ADR-0054](../adr/0054-design-language-instrument.md)) from the first pixel.

**The app was the forcing function; now it is the proof.** This deliverable was originally scoped as one with the extraction, on the argument that "an extraction with one consumer is speculation with extra folders". The operator split them because the second consumer's requirements were already known well enough to design against — so the burden this deliverable carries is the other half of that bet: **anything `apps/customer` cannot build from the packages without changing them is a finding against D8–D11**, recorded as such in this file rather than patched silently. A package diff in this deliverable is either a named finding or a defect in the step that made it.

## The sharing decision (settled in scoping, 2026-08-20)

**Separate apps, not one merged app.** The population boundary is the app boundary: [ADR-0017](../adr/0017-identity-model-populations-and-roles.md) split `staff` and `user` into separate tables, flows and segments, and the [ADR-0033](../adr/0033-browser-api-client-and-session.md) session machine — in-memory token, single-flight refresh, CSRF bootstrap — is built around one population per client. A merged app would run two session models in one SPA, ship the admin panel's code in every customer's bundle, and put the customer-facing attack surface in the same origin as staff sessions. Impersonation ([D13](0013-impersonation.md)) also gets _cleaner_ with separation: the staff session and the impersonated customer session never coexist in one client.

## The decisions, taken 2026-08-31

All in [ADR-0055](../adr/0055-customer-app.md), written at opening and deliberately mostly by reference: the roster (customer joins at 3002; `apps/web` is marketing only, its architecture D14's — the supersession of frozen 0022 the 2026-08-22 re-scoping deferred to "the day an app actually changes"); the architecture as the admin's records applied through the app's own `shared/` doors; the `/user`-segment deltas — **no roles and no policy table** (configs offer, the API refuses; ADR-0042 stays an admin record), the slim account control in `headerEnd` (the slot's promised second consumer), 0053's account-area shape with **deletion in the security section**, **no grid until a domain entity arrives**, and the bundle budget from first build; and the **three self-service endpoints the segment lacks** — profile read/write, password change with 0027's re-auth and session-revocation rules, and self-deletion with 0028's semantics plus password re-auth and every-session-revoked. Email change, registration and password reset stay deliberately unwritten (the Planned list).

## Assumptions (revisable while in progress)

- **Self-service v1 only.** No customer-ownable domain entity exists; the grid, real navigation and list screens arrive with the first one the operator names. If one is named mid-deliverable, it folds in here and this file gains the scope.
- **The e2e smoke stays read-and-restore.** Self-deletion is never run against the dev database (it would consume a seeded fixture with no registration endpoint to replace it); its proof is the integration tier and the MSW tier. The tier's ADR-0020 request budget grows with the customer specs and the probe's floor moves with it.
- **The i18n tooling pattern is the admin's** (`i18n:check`/`i18n:extract`, the type-source `en`, the drift check in `pnpm check`), instantiated per app.

## Build order

### ~~1. The record, the scaffold and the boot~~ — **done 2026-08-31**

**ADRs:** [0055](../adr/0055-customer-app.md) (accepted at the head of this step; 0022 moves to `superseded by`; the index and window documents swept in the same commit), [0002](../adr/0002-monorepo-layout-and-tooling.md), [0054](../adr/0054-design-language-instrument.md) §1–§2, [0046](../adr/0046-interface-localization.md)

`apps/customer` scaffolded from the shared configs: Vite on 3002, TypeScript, eslint with its own `boundaries` config, vitest, `.env.example` + `turbo.json` env per ADR-0004, `@fontsource` imports beside the token sheet, `createI18n` mounted with the app's own namespaces (`en` + `lv` from the start), the route tree with `_auth.login` rendering a customer `AuthLayout` in Instrument, and the app's own pseudo-locale walk. A committed `size-budget.json` baselined at first build, with the `size` task covering the app — the D10.5 mechanism 0052 promised this app would inherit.

**Done when:** `pnpm check` green with the customer's lint, check-types, test:unit and i18n:check in the graph; `pnpm build --filter customer` succeeds; `pnpm size` reports both apps inside their budgets; the pseudo suite walks the tree; the gate green.

### 2. Session, sign-in and the guards

**ADRs:** [0033](../adr/0033-browser-api-client-and-session.md) as carried by [0051](../adr/0051-platform-extraction.md), [0030](../adr/0030-csrf-bootstrap-endpoint.md), [0036](../adr/0036-admin-testing-strategy.md)

`createApiClient({ segment: "user" })` behind the app's `shared/api` door, the boot gate, `_auth`/`_dashboard` guard topology, the login feature over `loginBody`, logout; the MSW harness (`renderApp`, handlers parsed by contracts) mirroring 0036.

**Done when:** the login suite asserts submit-lock, refusal copy through the code map, and the redirect; a guard suite asserts the protected tree turns an unauthenticated boot to `/login` and back; the gate green.

### 3. API — the profile, read and written

**ADRs:** [0055](../adr/0055-customer-app.md) §4, [0027](../adr/0027-credential-self-service-and-reset.md), [0009](../adr/0009-api-modular-layering.md), [0021](../adr/0021-testing-strategy.md)

`GET /api/v1/user/profile`, `PATCH /api/v1/user/profile` (names; email read-only) and `POST /api/v1/user/profile/password` with 0027's self-service rules verbatim — current password required, other sessions revoked, the calling one kept. Contracts schemas, guard-matrix rows, integration tests, Postman requests with envelope and refusal assertions.

**Done when:** `pnpm test:int --filter api` green including the new cases (wrong password refused; other-session token dead after a change; the calling token alive); `pnpm test:postman` green with the added requests; the gate green.

### 4. API — self-deletion

**ADRs:** [0055](../adr/0055-customer-app.md) §4, [0028](../adr/0028-account-deletion.md), [0013](../adr/0013-error-model.md)

`DELETE /api/v1/user/profile`: current password required, soft delete with 0028's user semantics carried exactly, **every** session revoked including the caller's. Integration tests prove the refusals, the soft row, the dead tokens and the email's post-deletion state under the partial index; Postman entries.

**Done when:** `pnpm test:int --filter api` green on the new cases; `pnpm test:postman` green; the gate green.

### 5. The shell and home

**ADRs:** [0048](../adr/0048-app-shell-and-record-surfaces.md) as carried, [0054](../adr/0054-design-language-instrument.md) §5, [0053](../adr/0053-account-area.md) §2

`AppShell` adopted: the app's sidebar node (brand, a minimal nav, the version footer with the app's own build-time constant), `headerEnd` holding the Instrument account control opening the slim popover — identity, **Account**, **Sign out** — and a `_dashboard.index` home that states what v1 is instead of pretending to a dashboard.

**Done when:** the adapter suite asserts the shell mounts with the app's nodes; a popover suite asserts exactly the three entries and no `menuitemradio`; the gate green.

### 6. `/account` — profile and security

**ADRs:** [0053](../adr/0053-account-area.md), [0055](../adr/0055-customer-app.md) §3, [0044](../adr/0044-record-routes-without-list-state.md) (the heading rule)

The route family on `SettingsLayout`; the profile section's details form over `PATCH /user/profile`; the security section's password dialog with copy written for a customer (0027's consequences stated where felt).

**Done when:** routing tests assert each section deep-links with its own title and `/account` lands on profile; the form and dialog suites green (submit-lock, server refusal landing, success path); the gate green.

### 7. Preferences

**ADRs:** [0045](../adr/0045-user-settings.md) as carried by [0053](../adr/0053-account-area.md), [0046](../adr/0046-interface-localization.md) §4

The preferences section: theme cards, self-named language rows, density — all writing `/user/settings` through the app's settings entity and the coalescing writer, exactly the admin's paths on the other segment.

**Done when:** suites assert each control writes through settings and the boot adopts the account's values; the gate green.

### 8. Security — delete account

**ADRs:** [0055](../adr/0055-customer-app.md) §4, [0028](../adr/0028-account-deletion.md), [0034](../adr/0034-server-state-and-notifications.md) as carried by [0043](../adr/0043-readable-list-search-params.md)

The deletion flow in the security section: a confirm that states 0028's consequences truthfully, the current-password field, refusals rendered in place, and the signed-out end state (the API revoked everything; the client lands on `/login` with the session store cleared).

**Done when:** the feature suite asserts the password is required, a refusal lands in the dialog, and success ends signed out; the MSW handler is no more permissive than the endpoint; the gate green.

### 9. Localization closed

**ADRs:** [0046](../adr/0046-interface-localization.md), [0002](../adr/0002-monorepo-layout-and-tooling.md)

`no-literal-string` fatal for the app, the drift check (`i18n:check`) in `pnpm check` if not already from `D12.1`, the `lv` catalogues drafted across every namespace and marked `pending native review`, the pseudo walk over the full route tree.

**Done when:** `pnpm --filter customer i18n:check` clean; a deliberate literal and a deliberate `lv` gap each fail their check (run once, reverted); the pseudo suite green; the gate green.

### 10. The e2e smoke

**ADRs:** [0052](../adr/0052-grid-and-admin-followups.md) (the tier and its data rules), [0055](../adr/0055-customer-app.md)

The Playwright tier gains a customer project: sign-in, the account sections from cold URLs, a theme-and-locale round trip restored after, per the invariant data rules. **No deletion e2e** (the assumption above). The probe's request-budget floor moves for the added specs.

**Done when:** `pnpm test:e2e` green with the customer specs on a clear window; the probe's stated budget covers the enlarged run; `pnpm test`'s shape untouched; the gate green.

### 11. Close-out

**ADRs:** none of its own — the checklist below

**Done when:** every §Definition-of-done item is checked or recorded as pending operator acceptance; the row reads `shipped`; the window on 0055 is shut.

## Findings against D8–D11

The deliverable's standing rule, run as a running list: **anything `apps/customer` cannot build from the packages without changing them is a finding against D8–D11**, recorded here with its reason. §Definition-of-done item 3 makes the empty list the claim — a `packages/*` diff that is neither named here nor absent is a defect of the step that made it.

**Two so far, both at `D12.1`, and neither has been acted on — which is the point of writing them down.** (A third thing `D12.1` found was not a finding but a defect of the record, so it was amended rather than logged: ADR-0055 §1 reassigned port 3002 to this app and left `apps/web` asking for it, which made `pnpm dev` a race. §1 carries the labelled amendment and `apps/web` moved to 3003.)

1. **`@repo/app-services`' theme key reads `machxi.admin.theme` in an app that is not the admin.** `D9.6` declined to parameterise it deliberately and said so: the key is per-origin, the two SPAs are two origins, and inventing a parameter for a collision that cannot happen would be a generalisation D9 forbade itself — naming D12 as the deliverable that finds out whether the _name_ reads wrong in a second app. It does, in exactly the harmless way that comment predicted: nothing collides, nothing breaks, and the string in a customer's devtools says `admin`. `@repo/i18n`'s `LOCALE_STORAGE_KEY` has the same shape. **One parameter each**, and the step that spends it should be the one with a reason beyond tidiness — a support call about a stored value, or the third app.
2. **ADR-0054 §7's login shell has its second consumer, and it is still app code in both apps.** §7 names `apps/admin/src/widgets/auth-layout` as app code on the argument that a composition with one consumer is a package's worth of indirection around a screen. `apps/customer/src/widgets/auth-layout` is now the same geometry — the hairline ground, the 400px column, the caps/28px/14px heading block — with different copy and a different card. That is **the argument's stated precondition changing**, not the record being wrong, so the finding is that the _next_ pressure on this geometry (a third consumer, or a §7 change that must land twice) is what moves it into `@repo/ui/compositions`. Moving it now would cost a package API for a guess about which parts the third app varies.

Neither is a package diff, so item 3's list of _diffs_ is still empty. Both are recorded because the alternative is that the second consumer arrives, notices, and says nothing — which is the failure this deliverable was split out to prevent.

## Definition of done

1. **Self-service works end to end**: sign-in, profile edit, password change, settings round trip and deletion — each with the named integration/MSW evidence above, and the smoke walking what a browser can walk without destroying a fixture.
2. **`apps/admin` is untouched**: `git diff` for `apps/admin` across the deliverable is empty, and the admin's suites are green unchanged.
3. **The packages held, or the findings are named**: every diff under `packages/*` in this deliverable is recorded in this file as a finding against D8–D11 with its reason — an empty list is the bet won.
4. **Both catalogues complete** for the customer app; the pseudo suite green over its tree; `lv` marked pending native review beside the files.
5. **The gate keeps its shape**: `pnpm lint && pnpm check-types && pnpm test && pnpm size` green with both apps inside their budgets; `pnpm test:unit` twice, the second fully cached; `pnpm test:e2e` green beside on a clear window.
6. **The API's growth is covered**: the three new endpoints in the integration tier and the Postman collection, with refusal assertions; nothing else in the API diff.
7. **Records agree**: 0055 `accepted` with labelled amendments; 0022 `superseded by ADR-0055`; the index's cells name the steps; the window documents in one reading pass.
8. **Named for the operator**: a browser walk of the customer app beside the Instrument reference (the screens exist in no shots tooling yet — walked or accepted explicitly, never folded into "shipped").
