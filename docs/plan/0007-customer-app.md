# D7 — Customer app and platform extraction

- Status: **planned** — opens when D6 ships
- Steps: written when the deliverable opens; this file carries scope, order rationale and the assumptions taken
- Ledger: [`docs/plan/README.md`](README.md)

Scope: two halves that are one deliverable on purpose. First, the app-agnostic machinery leaves `apps/admin/src/shared` for workspace packages. Second, **`apps/customer`** — a Vite + React SPA over the `/user` segment, the same shape as `apps/admin` — is scaffolded as that machinery's **second consumer**, shipping self-service v1: sign-in on the ADR-0033 session model, profile, credential self-service (ADR-0027), settings (D5), and account deletion (ADR-0028). The halves stay together because an extraction with one consumer is speculation with extra folders; the second app is the forcing function that makes every seam honest, and the admin panel staying green on the extracted packages is the extraction's real test.

## The sharing decision (settled in scoping, 2026-08-20)

**Separate apps, not one merged app.** The population boundary is the app boundary: ADR-0017 split `staff` and `user` into separate tables, flows and segments, and the ADR-0033 session machine — in-memory token, single-flight refresh, CSRF bootstrap — is built around one population per client. A merged app would run two session models in one SPA, ship the admin panel's code in every customer's bundle, and put the customer-facing attack surface in the same origin as staff sessions. Impersonation (D8) also gets *cleaner* with separation: the staff session and the impersonated customer session never coexist in one client. What the apps share is machinery, and machinery is what packages are for.

**`apps/web` is re-scoped to a marketing site and moves last (D9).** That narrows frozen ADR-0022's "public/user-facing app: Next.js" identity, so this deliverable opens with a superseding ADR for the app roster — admin, customer, web-as-marketing — including dev ports (0022 gave 3002 to `web`; the roster ADR reassigns).

## Extraction candidates (the ADR draws the final line)

From `apps/admin/src/shared`, roughly in dependency order: the API client + session + CSRF machinery (parameterized by population/segment — the one real generalization this extraction demands), notifications, the RHF form machinery, the grid (AppGrid, preferences store and adapters), the resource-config machinery, the theme provider, and the app shell (the sidebar layout `widgets/` builds on). Package granularity is the ADR's decision; house precedent (`contracts`, `crypto`, `logger`) favors focused packages over one `@repo/app-platform`. Each app keeps its FSD `shared/` layer as thin doors re-exporting from the packages — ADR-0031's one-door pattern generalized — and `pages`/`features`/`entities` stay strictly per-app. Strings inside extracted machinery follow D6's package/dictionary boundary, which is why this deliverable runs after localization: the components move already-dictionary-fed.

## Decisions this deliverable needs

- **Superseding ADR for ADR-0022** — the app roster, stacks and ports.
- **The extraction ADR** — package set, the parameterized session machinery, the per-app door rule, and its relationship to frozen ADR-0032/0033 (which describe this machinery as living *in* `apps/admin`): the ADR must carry that move explicitly rather than diverge silently.
- **The customer-app architecture ADR** — expected to be short and mostly by reference: FSD per 0032, session per 0033, server state per 0034, testing per 0036, with the `/user`-segment deltas (no staff roles, no ADR-0042 policy table beyond the trivial one) stated rather than implied.

## Assumptions taken 2026-08-20 (revisable until the deliverable opens)

- **Self-service v1 only.** Today's API has no customer-ownable domain entity, so v1 proves the shell, session, forms, settings and localization with zero new domain modeling — the customer grid gets its first real consumer when a domain entity is named. If one is named before this opens (orders, documents, bookings…), its API module and screen fold in here and this file gains the scope.

## Acceptance sketch

`apps/admin` fully green on the extracted packages with no behavior change — the walk and the test totals both say so; `apps/customer` signs in, refreshes after reload through the ADR-0030 bootstrap, edits profile and settings, changes a password, deletes an account (ADR-0028 semantics), all localized in both locales; its MSW test tier mirrors ADR-0036; both apps build; the gate is green across the workspace and the Postman collection covers any `/user` endpoints the deliverable added.
