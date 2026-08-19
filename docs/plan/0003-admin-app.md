# D3 — Admin panel

- Status: **in progress**, opened 2026-08-19
- Steps: `D3.1` – `D3.10`
- Ledger: [`docs/plan/README.md`](README.md)

Scope: build `apps/admin` — the staff-facing panel ADR-0022 configured — against the API surface D1 and D2 shipped, plus the two prerequisites the app cannot exist without: the `packages/ui` design system and the `GET /auth/csrf` bootstrap endpoint. **`apps/web` is not in this deliverable.** The ledger's old D3 row said "frontend apps"; the two apps share almost nothing beyond `@repo/ui` — different framework, different segments, different session model — so `web` is staged as D4 and this deliverable stays one app deep. No new API surface beyond ADR-0030.

The feature surface is exactly what the admin segment already exposes: login/logout/logout-all/refresh on cookie transport, staff CRUD with administrative password reset, users CRUD (soft delete) with reset, and the caller's own profile with password change. Two resources and a profile page are deliberately the whole product — they are the proof of the config-driven machinery, not a feature backlog.

Each step names the ADRs that govern it. Read them before implementing — they carry the reasoning, this file carries the work. Every step ends green on `pnpm lint && pnpm check-types && pnpm test` and a conventional commit.

**Amendment window.** ADRs 0030–0036 were written for this deliverable and may be amended in place while it is in progress, labelled `**Amended YYYY-MM-DD (D3.N).**` at the point of change ([ADR-0025](../adr/0025-deliverables.md) rule 2). ADRs 0001–0029 belong to shipped D1/D2 and are closed: if the work below needs one of them to say something different, stop and write a superseding ADR ([ADR-0024](../adr/0024-adr-lifecycle.md) rule 1).

**Gate.** ADRs 0030–0036 were written `proposed` and accepted 2026-08-19, before any implementing step started — [ADR-0025](../adr/0025-deliverables.md) rule 3 keeps "agreed" and "built" as separate facts, and the acceptance un-gates every step below. A future amendment that changes a decision re-gates only the steps that build it.

## Build order

### 1. `packages/ui` — the design system

**ADRs:** [0031](../adr/0031-ui-design-system.md), [0022](../adr/0022-frontend-apps.md), [0002](../adr/0002-monorepo-layout-and-tooling.md)

The step the ledger has named as D3's blocker since D2 opened. `@repo/ui` becomes the shadcn/ui design system on Tailwind v4: CSS-first theme tokens in one exported stylesheet, components committed as source under `packages/ui/src/components`, per-app `components.json` pointing the shadcn CLI at the workspace package. The template scaffolding (`counter-button`, `link`) is deleted; `apps/web` gets the minimal edit that keeps it compiling — building `web` out is D4's problem. Land the primitives D3 is known to need (the `Field` family, `sonner`, and the sidebar-07 / login-01 block foundations) so later steps add features, not infrastructure.

**Done when:** both apps build with the package's stylesheet imported; `pnpm lint && pnpm check-types && pnpm test` green across the workspace; the template components are gone; a dark/light toggle flips tokens in a rendered primitive.

### 2. `GET /auth/csrf` — the bootstrap endpoint

**ADRs:** [0030](../adr/0030-csrf-bootstrap-endpoint.md), [0029](../adr/0029-browser-token-transport.md), [0012](../adr/0012-response-envelope.md), [0020](../adr/0020-security-baseline.md) §Rate limiting

The one API change in this deliverable, and it lands before any client code depends on it — the same sequencing D2.5 used. Unauthenticated `GET /api/v1/{user,admin}/auth/csrf` on the existing auth routers: sets/rotates `__Host-machxi.csrf` and returns the value as `respond.ok({ csrfToken })` via a new `CsrfResource` in `@repo/contracts`. Use `/add-endpoint`; integration tests cover cookie set + body echo for both segments, the guard-matrix test gains the route as unauthenticated, and the Postman collection gains the request (`/postman-sync`).

**Done when:** both segments answer with the cookie and the body copy agreeing; the refresh limiter provably does not count the call; `pnpm test:postman` green.

### 3. Admin app skeleton — FSD, router, layouts, test harness

**ADRs:** [0032](../adr/0032-admin-app-architecture.md), [0031](../adr/0031-ui-design-system.md), [0036](../adr/0036-admin-testing-strategy.md)

`apps/admin` gets its shape: the FSD layer tree with `eslint-plugin-boundaries` enforcing the import direction, TanStack Router v1 file-based under `src/app/routes` with `autoCodeSplitting`, the two pathless layouts (`_auth` carrying the login-01 shell, `_dashboard` carrying the sidebar-07 shell with a collapsible drawer sidebar), and placeholder pages behind them. The ADR-0036 harness lands here too — Vitest + Testing Library + jsdom + MSW wired, `--passWithNoTests` removed with the first real test. No data, no auth yet; guards are stubbed to let the shell render.

**Done when:** `pnpm dev --filter admin` serves both layouts; an upward FSD import fails `pnpm lint`; the first component test runs in the cached `test:unit` loop.

### 4. Browser session — API client, token store, login

**ADRs:** [0033](../adr/0033-browser-api-client-and-session.md), [0030](../adr/0030-csrf-bootstrap-endpoint.md), [0029](../adr/0029-browser-token-transport.md), [0013](../adr/0013-error-model.md)

`shared/config` (zod-validated `import.meta.env`, `VITE_API_URL`, `apps/admin/.env.example`), `shared/api` (axios instance, envelope unwrap, branded `ApiClientError` + `isApiClientError`, in-memory session store, single-flight 401 refresh), the boot sequence (`GET /auth/csrf` → `POST /auth/refresh` behind a loading gate), real route guards in `_dashboard`/`_auth` `beforeLoad`, and the login feature on the login-01 screen with fields disabled while the mutation is pending. Logout wired in the dashboard shell. MSW suites cover bootstrap, single-flight refresh with queued retries, and every terminal auth code landing on `/login`.

**Done when:** login → dashboard → reload keeps the session → logout → guarded routes redirect, against the real API in dev; the session flows are green in the cached unit loop against MSW.

### 5. Server state and notifications

**ADRs:** [0034](../adr/0034-server-state-and-notifications.md), [0014](../adr/0014-pagination-filtering-sorting.md)

The QueryClient with its decided defaults, per-entity query-key factories and API functions in `entities/{staff,user}`, list state validated into the URL by the `@repo/contracts` list schemas through TanStack Router search params, and the notification layer: `<Toaster>` mounted once, `MutationCache`/`QueryCache` global handlers reading typed `meta`, the error-code → message map over the contracts union.

**Done when:** a list hook driven from URL search params refetches on param change; a mutation with `meta.success` toasts without any call-site `toast()`; an `ApiClientError` code renders its mapped message; all covered by MSW tests.

### 6. Resource UI machinery — AppGrid and config-driven forms

**ADRs:** [0035](../adr/0035-config-driven-resource-ui.md), [0031](../adr/0031-ui-design-system.md), [0034](../adr/0034-server-state-and-notifications.md)

The machinery both resource steps consume: the `ResourceConfig` shape (columns + fields declared once per resource), the grid registry (formatters, cell renderers by key) and `AppGrid` — TanStack Table v8 in manual mode (`manualPagination`/`manualSorting`/`manualFiltering`, `rowCount` from `meta.pagination.total`) rendered with `@repo/ui` `Table` primitives, state controlled from the URL search params per ADR-0014/0034, a real pager including the stranded-offset and `total: null` branches, sort and filter controls only where the contract allow-lists them; the field-component registry, `AppFormProvider` (RHF `FormProvider` + config context, `zodResolver` over the contracts schema), `AppFormInput`, and the submit lock (mutation `isPending` → `useForm` `disabled` + `fieldset` + button state). Registry resolution, `fieldName` typing, submit-lock behaviour and server-error `setError` mapping all get unit tests.

**Done when:** a demo resource config renders a themed grid and a working form entirely from config; every field provably disables during a pending mutation; a config typo on `fieldName` is a compile error.

### 7. Staff resource

**ADRs:** [0035](../adr/0035-config-driven-resource-ui.md), [0027](../adr/0027-credential-self-service-and-reset.md), [0028](../adr/0028-account-deletion.md)

The first real consumer: staff resource config, grid page with URL-driven pagination/sort, create and edit forms from config (roles multi-select, status), the administrative password-reset dialog (the actor re-presents their own password, ADR-0027), delete with confirm — refusals the API enforces (rank rule, last super admin, self-deletion) surfacing through the ADR-0034 error map rather than being pre-guessed in the client.

**Done when:** every staff endpoint the API exposes is reachable from the page; the flows are covered by MSW component tests; a manual walk against the dev API with the dev seed succeeds.

### 8. Users resource

**ADRs:** [0035](../adr/0035-config-driven-resource-ui.md), [0028](../adr/0028-account-deletion.md), [0027](../adr/0027-credential-self-service-and-reset.md)

The second consumer, and the measure of the machinery: users config, grid, edit form, soft-delete with confirm (deleted rows still listed per ADR-0028's read path, visibly marked), password reset, and the `USER_DELETED` refusals surfacing correctly. The step's real deliverable is the diff staying thin — config plus thin pages, no new machinery. Where it is not thin, the finding goes to ADR-0035's amendment, not to a workaround.

**Done when:** same bar as staff; and the step's diff contains no change under `shared/`.

### 9. Profile

**ADRs:** [0027](../adr/0027-credential-self-service-and-reset.md), [0035](../adr/0035-config-driven-resource-ui.md)

The caller's own account: profile page from `GET /admin/profile`, name edits, change-password (revokes every other session, ADR-0027 — say so in the UI), rendered inside the dashboard shell with the current principal in the sidebar footer.

**Done when:** profile read/update/change-password work end to end; changing the password keeps the current session alive and a second signed-in browser context loses its session.

### 10. Close-out

**ADRs:** [0025](../adr/0025-deliverables.md) rule 4

- Fill the _Implemented_ column in `docs/adr/README.md` for ADRs 0030–0036 in `D3.N` form.
- Sync `CLAUDE.md` (frontend non-negotiables, commands, repo map), `docs/README.md`, and both `.env.example`s with anything the steps changed.
- Decide and land the D3 tooling from the design discussion: the `ui-builder` agent and the `frontend-conventions`, `new-resource-ui` and `ui-component` skills, encoding the accepted ADRs' checklists.
- Run the acceptance checklist below on a fresh clone.
- Move the D3 row in `docs/plan/README.md` to `shipped YYYY-MM-DD`, which shuts the amendment window on ADRs 0030–0036.

## Definition of done

D3 is closed when every step above is closed and this checklist passes on a fresh clone:

1. `pnpm i && cp .env.example .env && pnpm docker:up && pnpm db:setup && pnpm db:seed -- --dev` — Postgres healthy, fixtures seeded.
2. `pnpm lint && pnpm check-types` clean, and `git status` clean afterwards.
3. `pnpm test` green, twice, uncached both times for the API; `pnpm test:unit` twice hits cache the second time — admin's suites among the cached.
4. `pnpm dev --filter api` and `pnpm dev --filter admin`; sign in as the seeded super admin at `http://localhost:3001`.
5. The walk: staff grid pages/sorts from the URL → create a staff member → edit → reset their password re-presenting your own → delete; users grid → edit → soft-delete → the row stays listed as deleted → re-register the address; profile → change password → a second browser context is signed out; every mutation toasts, every form locks while pending.
6. Reload mid-session — the app bootstraps from the cookie and stays signed in. `pnpm test:postman` green, untouched by the frontend.
