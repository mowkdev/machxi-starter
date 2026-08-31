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

### ~~2. Session, sign-in and the guards~~ — **done 2026-08-31**

**ADRs:** [0033](../adr/0033-browser-api-client-and-session.md) as carried by [0051](../adr/0051-platform-extraction.md), [0030](../adr/0030-csrf-bootstrap-endpoint.md), [0036](../adr/0036-admin-testing-strategy.md)

`createApiClient({ segment: "user" })` behind the app's `shared/api` door, the boot gate, `_auth`/`_dashboard` guard topology, the login feature over `loginBody`, logout; the MSW harness (`renderApp`, handlers parsed by contracts) mirroring 0036.

**Done when:** the login suite asserts submit-lock, refusal copy through the code map, and the redirect; a guard suite asserts the protected tree turns an unauthenticated boot to `/login` and back; the gate green.

### 3. API — the profile, read and written

**ADRs:** [0055](../adr/0055-customer-app.md) §4, [0027](../adr/0027-credential-self-service-and-reset.md), [0009](../adr/0009-api-modular-layering.md), [0021](../adr/0021-testing-strategy.md)

**Amended 2026-08-31 (`D12.2`) — this step is a verification, not a construction.** `D12.2`'s orientation found all three endpoints already shipped at **D2.3/D2.4**: `GET` and `PATCH /api/v1/user/profile`, and `POST /api/v1/user/profile/change-password` (that path, not the `/password` ADR-0055 §4 spelled — the record's invention, amended there). They have contracts schemas, `apps/api/test/user-profile.int.test.ts` and a Postman folder. Scoping wrote this step from ADR-0055's §Context claim that the segment "holds auth and settings only", and nobody opened the router.

The work that remains is real but different: **read the shipped three against 0027's rules and close whatever the reading finds** — the current password required despite a valid session, every _other_ session revoked, the calling one kept — and add the cases the existing tier does not already assert. If the reading finds nothing, the step is a paragraph in this file saying so and the deliverable is one step shorter, which is the honest outcome and not a failure.

**Done when:** the three endpoints are read against ADR-0027 and each rule is either shown to be covered by a named existing test or covered by a new one; `pnpm test:int --filter api` green; `pnpm test:postman` green; the gate green.

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

**Six so far, and none has been acted on — which is the point of writing them down.**

Two things the steps found were **not** findings but errors in the records themselves, so they were amended in place rather than logged here: `D12.1` found ADR-0055 §1 reassigning port 3002 to this app while leaving `apps/web` asking for it, and `D12.2` found §4 claiming the `/user` segment has no profile read, write or password change when all three shipped at D2.3/D2.4. A record that is wrong about the code is a different thing from a package that cannot serve a second consumer, and only the second kind belongs in this list.

1. **`@repo/app-services`' theme key reads `machxi.admin.theme` in an app that is not the admin.** `D9.6` declined to parameterise it deliberately and said so: the key is per-origin, the two SPAs are two origins, and inventing a parameter for a collision that cannot happen would be a generalisation D9 forbade itself — naming D12 as the deliverable that finds out whether the _name_ reads wrong in a second app. It does, in exactly the harmless way that comment predicted: nothing collides, nothing breaks, and the string in a customer's devtools says `admin`. `@repo/i18n`'s `LOCALE_STORAGE_KEY` has the same shape. **One parameter each**, and the step that spends it should be the one with a reason beyond tidiness — a support call about a stored value, or the third app.
2. **ADR-0054 §7's login shell has its second consumer, and it is still app code in both apps.** §7 names `apps/admin/src/widgets/auth-layout` as app code on the argument that a composition with one consumer is a package's worth of indirection around a screen. `apps/customer/src/widgets/auth-layout` is now the same geometry — the hairline ground, the 400px column, the caps/28px/14px heading block — with different copy and a different card. That is **the argument's stated precondition changing**, not the record being wrong, so the finding is that the _next_ pressure on this geometry (a third consumer, or a §7 change that must land twice) is what moves it into `@repo/ui/compositions`. Moving it now would cost a package API for a guess about which parts the third app varies.

3. **An unrecognised error code degrades to "check your connection", not to the catalogue's fallback** (`D12.2`). ADR-0013 tells a client to degrade on a code it has never heard of, and `createMessageForError`'s `defaultValue` is each app's half of that instruction. **It is unreachable from the wire.** `@repo/api-client` parses the body with `errorEnvelopeSchema`, whose `code` is `z.enum(ERROR_CODES)`, so a code newer than the bundle fails the parse; the response then stops being an envelope at all and is normalised to `TRANSPORT_ERROR_CODE` — which is `SERVICE_UNAVAILABLE`. An older bundle meeting a newer API therefore tells the person to check their connection about a refusal the server delivered perfectly well, and no `defaultValue` anywhere can intercept it.

   Found by writing the test the admin never wrote, which is this deliverable working as intended: the behaviour is identical in `apps/admin` and always has been. The fix is a `@repo/api-client` diff — parse the envelope with the code as a plain `string` and narrow afterwards, so an unknown code stays a _refusal_ with an unknown name — and it belongs to whoever owns that package's next window, not to a step of this one. `apps/customer/src/features/auth/__tests__/login-form.test.tsx` pins the current behaviour with the reasoning beside it, so the fix will be a visible diff rather than a silent improvement.

4. **`src/test/msw/handlers/envelope.ts` is the same file twice** (`D12.2`). It holds no app knowledge whatsoever — only `@repo/contracts` types and two builders over them — and is the clearest candidate D12 has produced for shared test support. It was copied rather than extracted for the reason every other duplication here was: the deliverable's rule is that a package diff is named first, and there is no test-support package to put it in, so creating one is a decision rather than a tidy-up. The customer's copy is already _narrower_ — no `listOk`, because ADR-0055 §3 mounts no grid — which is itself an argument that a shared version would need a shape neither app has yet.

5. **`SessionProvider` is duplicated at ~170 lines and its boot gate is not app-specific** (`D12.2`). What differs between the two copies is one word (`segment`), one narrowed principal type, and the wording of the unreachable notice. The rest — the module-scope singletons, the `onSessionEnded` late binding, and in particular the `StrictMode` latch whose failure mode is a permanently blank screen — is machinery ADR-0033 decided once. It is the largest single duplication this app has produced, and unlike the login shell (finding 2) the two copies are not _meant_ to diverge. It stays a finding rather than a change because the extraction carries a real design question — the notice's copy belongs to an app and the gate's behaviour to a package, so the seam is a prop pair rather than a straight move — and `@repo/api-client` already owns the boot sequence it would join.

6. **One `__Host-machxi.csrf` cookie at `Path=/` now serves two populations** (`D12.2`, from the step's security review). Refresh cookies are correctly per-segment — `authCookiePath` scopes them to `/api/v1/{admin,user}/auth` — but the CSRF cookie is deliberately host-wide (`apps/api/src/core/http/cookies.ts`: `__Host-` requires `Path=/`, and the app's own pages have to read it). `setAuthCookies` rotates it on **every** login and refresh. Until this deliverable exactly one SPA could hold a session against a given API host, so rotation was always the rotating client's own. It is not any more: with the admin panel and the customer app open against the same host, an admin refresh strands the customer's in-memory CSRF token and vice versa. The client recovers with one re-bootstrap (ADR-0030's endpoint echoes rather than rotates, which is why `CSRF_TOKEN_INVALID` stopped being terminal at `D3.2`), but a second `403` inside that window **is** terminal — a forced sign-out caused by unrelated traffic in another tab.

   The first finding here that is neither a duplication nor a bug in one app: it is a property of the _deployment_ that only a second SPA could expose, which is precisely what this deliverable was split out to find. It is also **not amendable** — [ADR-0029](../adr/0029-browser-token-transport.md) is frozen and decided this cookie's shape — so it needs a superseding record rather than a patch, and that record has to weigh a per-population cookie name against `__Host-`'s `Path=/` requirement. Unreachable in dev today only because nobody runs both apps signed in at once; the browser tier (`D12.10`) is where it would first bite.

Findings 1, 2 and 4 are duplications the deliverable expected; finding 5 is a larger one it did not; findings 3 and 6 are defects, and 6 needs an ADR rather than a fix. **None is a `packages/*` diff**, so §Definition-of-done item 3's list of _diffs_ is still empty. All are recorded because the alternative is that the second consumer arrives, notices, and says nothing — which is the failure this deliverable was split out to prevent.

## Definition of done

1. **Self-service works end to end**: sign-in, profile edit, password change, settings round trip and deletion — each with the named integration/MSW evidence above, and the smoke walking what a browser can walk without destroying a fixture.
2. **`apps/admin` is untouched**: `git diff` for `apps/admin` across the deliverable is empty, and the admin's suites are green unchanged.
3. **The packages held, or the findings are named**: every diff under `packages/*` in this deliverable is recorded in this file as a finding against D8–D11 with its reason — an empty list is the bet won.
4. **Both catalogues complete** for the customer app; the pseudo suite green over its tree; `lv` marked pending native review beside the files.
5. **The gate keeps its shape**: `pnpm lint && pnpm check-types && pnpm test && pnpm size` green with both apps inside their budgets; `pnpm test:unit` twice, the second fully cached; `pnpm test:e2e` green beside on a clear window.
6. **The API's growth is covered**: the three new endpoints in the integration tier and the Postman collection, with refusal assertions; nothing else in the API diff.
7. **Records agree**: 0055 `accepted` with labelled amendments; 0022 `superseded by ADR-0055`; the index's cells name the steps; the window documents in one reading pass.
8. **Named for the operator**: a browser walk of the customer app beside the Instrument reference (the screens exist in no shots tooling yet — walked or accepted explicitly, never folded into "shipped").
