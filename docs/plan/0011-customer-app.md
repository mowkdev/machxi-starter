# D11 — Customer app

- Status: **planned** — opens when [D10](0010-grid-and-admin-followups.md) ships
- Steps: written when the deliverable opens; this file carries scope, order rationale and the assumptions taken
- Ledger: [`docs/plan/README.md`](README.md)

Scope: **`apps/customer`** — a Vite + React SPA over the `/user` segment, the same shape as `apps/admin` — built as the **second consumer** of the shell, surfaces and machinery that [D8](0008-app-shell-and-record-surfaces.md) designed and [D9](0009-platform-extraction.md) extracted. It ships self-service v1: sign-in on the ADR-0033 session model, profile, credential self-service ([ADR-0027](../adr/0027-credential-self-service-and-reset.md)), settings (D6) and account deletion ([ADR-0028](../adr/0028-account-deletion.md)), localized in both locales from the first screen.

**The app was the forcing function; now it is the proof.** This deliverable was originally scoped as one with the extraction, on the argument that "an extraction with one consumer is speculation with extra folders". The operator split them because the second consumer's requirements were already known well enough to design against — so the burden this deliverable carries is the other half of that bet: **anything `apps/customer` cannot build from the packages without changing them is a finding against D8 or D9**, recorded as such rather than patched here.

## The sharing decision (settled in scoping, 2026-08-20)

**Separate apps, not one merged app.** The population boundary is the app boundary: [ADR-0017](../adr/0017-identity-model-populations-and-roles.md) split `staff` and `user` into separate tables, flows and segments, and the [ADR-0033](../adr/0033-browser-api-client-and-session.md) session machine — in-memory token, single-flight refresh, CSRF bootstrap — is built around one population per client. A merged app would run two session models in one SPA, ship the admin panel's code in every customer's bundle, and put the customer-facing attack surface in the same origin as staff sessions. Impersonation ([D12](0012-impersonation.md)) also gets _cleaner_ with separation: the staff session and the impersonated customer session never coexist in one client.

**`apps/web` is re-scoped to a marketing site and moves last (D13).** That narrows frozen ADR-0022's "public/user-facing app: Next.js" identity. The superseding roster ADR is D9's to write or this deliverable's — it is strictly needed the day an app actually changes, which is this one.

## Decisions this deliverable needs

- **The customer-app architecture ADR** — expected to be short and mostly by reference: FSD per [0032](../adr/0032-admin-app-architecture.md), session per [0033](../adr/0033-browser-api-client-and-session.md), server state per [0043](../adr/0043-readable-list-search-params.md), testing per [0036](../adr/0036-admin-testing-strategy.md), localization per [0046](../adr/0046-interface-localization.md), with the `/user`-segment deltas stated rather than implied: no staff roles, no ADR-0042 policy table beyond the trivial one, and whichever shell slots this app fills differently from the admin panel.
- **The superseding roster ADR for [ADR-0022](../adr/0022-frontend-apps.md)**, if D9 did not already write it: the app roster, stacks and dev ports (0022 gave 3002 to `web`; the roster ADR reassigns).

## Assumptions taken 2026-08-20 (revisable until the deliverable opens)

- **Self-service v1 only.** Today's API has no customer-ownable domain entity, so v1 proves the shell, session, forms, settings and localization with zero new domain modeling — the customer grid gets its first real consumer when a domain entity is named. If one is named before this opens (orders, documents, bookings…), its API module and screen fold in here and this file gains the scope.

## Acceptance sketch

`apps/customer` signs in, refreshes after reload through the ADR-0030 bootstrap, edits profile and settings, changes a password and deletes an account with ADR-0028's semantics, all localized in both locales and all rendered through the D8 shell and surfaces; its MSW test tier mirrors ADR-0036; `apps/admin` is untouched by the deliverable and stays green; both apps build; the gate is green across the workspace; the Postman collection covers any `/user` endpoints this added; and every change the app needed in an extracted package is recorded as a finding against D8 or D9 rather than folded silently into this one.
