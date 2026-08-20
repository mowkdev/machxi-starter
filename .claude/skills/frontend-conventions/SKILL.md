---
name: frontend-conventions
description: Quick reference of the machxi admin-app conventions (FSD layers, design system, session, server state, resource UI, testing) condensed from ADRs 0030-0036. Load before writing or reviewing any code under apps/admin or packages/ui.
---

# Frontend conventions (condensed from docs/adr — ADRs win on conflict)

Covers `apps/admin` and `packages/ui`. The API side is `/api-conventions`.

## Layers (ADR-0032) — FSD, and the direction is lint-enforced

```
app  →  pages  →  widgets  →  features  →  entities  →  shared
```

```
src/app/        providers, routes/ (file-based), routeTree.gen.ts — wiring only
src/pages/      one slice per screen; thin composition
src/widgets/    self-contained blocks reused across pages (dashboard-layout, app-sidebar)
src/features/   interactions that change something (a form, a dialog, a mutation)
src/entities/   domain resources: query hooks, key factory, resource UI config
src/shared/     api/ ui/ form/ grid/ resource/ notifications/ lib/ config/ — no domain knowledge
```

- **Only downward, never sideways.** `eslint-plugin-boundaries` + `eslint-import-resolver-typescript` enforce it; a feature importing another feature, or anything importing from `app`, is a lint error. A pattern two features want gets _demoted_ into `entities`/`shared` or promoted to a widget.
- **Slices have a public API**: import `@/entities/staff`, not `@/entities/staff/staff.api`. Colocated tests are one exception and **`shared` is the other** — its slices are the app's own toolbox and are imported by path (`@/shared/grid/app-grid`), which the lint config states explicitly.
- **A hook two layers need lives in `shared`, not beside its provider** — `useApiClient`/`useSession` are in `shared/api/context` precisely because a feature may not reach into `app`.
- Routes are TanStack Router file-based: `_auth.*` (unauthenticated) and `_dashboard.*` (guarded in `_dashboard.tsx`'s `beforeLoad`). Adding a page under `_dashboard/` inherits the guard. `staticData: { title }` per route.

## Design system (ADR-0031)

- shadcn/ui (`new-york`, `neutral`) on Tailwind v4, owned as source in `packages/ui`; no build step.
- **Add a primitive with `/ui-component`.** `npx shadcn add <x>` run from `apps/admin` lands it in `@repo/ui` via `components.json` aliases — then move the radix dependency it installed into `packages/ui`.
- Generated files (`packages/ui/src/components/`, `src/hooks/`) are **prettier-exempt** and kept byte-identical to upstream; an edit to one carries a comment naming the rule that forced it.
- **One door**: every layer above `shared` imports design-system components from `@/shared/ui`, never `@repo/ui/components/*` (lint enforces it). The door is named re-exports only; a component with behaviour of its own is a file beside the door (`app-loader`, `confirm-dialog`, `query-error`).
- `lucide-react` may be a direct app dependency (icons are authoring, not design system); every other primitive dependency stays in `packages/ui`.

## Session and the API client (ADR-0033, ADR-0030)

- **Credentials live in memory only.** No access token, CSRF token or principal in `localStorage`, `sessionStorage` or a client-set cookie; the client never _reads_ `document.cookie`. Non-credential display state (theme, sidebar) may be persisted.
- Boot: `GET /auth/csrf` → `POST /auth/refresh`; the app renders nothing until it resolves. A failed refresh is `anonymous`; a failed bootstrap is "API unreachable" and is shown.
- One axios instance in `shared/api/client.ts`: bearer on every request, CSRF header on the three guarded paths, `X-Auth-Transport: cookie` on login/refresh, **single-flight** refresh on `401`, one bounded retry each for `401` and `403 CSRF_TOKEN_INVALID`, terminal codes end the session. Absolute URLs are refused.
- `client.ts` is the only writer of tokens. `useSetPrincipal` is the one narrow exception, for a profile rename.
- Failures are `ApiClientError` carrying a contracts `ErrorCode`; nothing branches on status alone.
- `apps/admin/.env` is its own file. Everything `VITE_*` is compile-time public — nothing secret, ever.

## Server state (ADR-0034)

- **TanStack Query owns all server state**; component state owns nothing a server sent.
- Query keys come from a per-entity factory (`staffKeys.list(params)`). Never inline a key array.
- **List state lives in the URL**: `validateSearch: listQuerySearchSchema`, `stripSearchParams(listSearchDefaults)`, and the parsed search _is_ the query key.
- **Queries are silent** (no toast) and therefore **must render their own failure** — `QueryError` in the place the data would have been, with a retry.
- **Mutations declare outcomes in `meta`**, and one global cache handler delivers them: `meta: { success: "…" }`, `meta: { errorToast: false }` where a form renders the failure inline. No `toast()` at a call site for a CRUD outcome.
- Invalidation: a mutation invalidates **its own entity's** keys (`lists()` + `detail(id)`); the **feature** invalidates whatever else the interaction touched (an entity may not import another entity). The test: does the response of any cached query change because of this write?
- A mutation whose variables carry a plaintext credential spreads `CREDENTIAL_MUTATION` (`gcTime: 0`) from `shared/api`.

## Resource UI (ADR-0035)

- **One `ResourceConfig` per resource**, in its entity slice: `columns`, `fields`, `errorFields`, written `as const satisfies ResourceConfig`. A resource with no grid (a singleton like the profile) declares a `FieldConfigMap` alone.
- **Configs are data.** Names, labels, initial values and registry _keys_ — never functions. Implementations live in named registries (`shared/grid/registry.ts`, `shared/form/registry.ts`); a typo'd key is a compile error.
- `AppGrid` is TanStack Table v9 in fully manual mode over shadcn `Table`: the engine sorts, filters and paginates nothing. A header click writes the URL, the query refetches.
- **Every `sortable` and every `filter` is a claim about the endpoint's `listQuerySchema`**, and it is tested (`__tests__/<x>.config.test.ts`) — including the negative controls.
- Forms are React Hook Form with `zodResolver(<the contracts schema the API validates with>)`; `AppFormDialog` is the frame (both providers, the `fieldset disabled aria-busy` lock, `AppFormError`, no dismissal mid-flight); edit submits are pruned to `dirtyFields`.
- **Layout is JSX, config is what a field is.** The day config grows a `layout` key, ADR-0035 needs superseding.
- Server failures: `applyServerErrors(error, form.setError, { fields: <this variant's names>, codeFields })`. It lands a `VALIDATION_ERROR` detail on its field verbatim (the detail's words are the contract's) and everything else at the form level through `ERROR_MESSAGES`.
- Operator-facing copy: **codes** are catalogued in `shared/notifications/messages.ts` (`Record<ErrorCode, string>` — a new code fails the build until someone writes a sentence); **field rules** are catalogued in the contracts schema. The API's own `error.message` is never rendered.

## Testing (ADR-0036)

- Vitest + Testing Library + MSW (`msw/node`). **No live-API tier**; an unhandled request is an error.
- Handlers are built from `@repo/contracts` — parse the request with the schema the API validates with, answer through the envelope builders. A handler modelling a refusal names the service function it mirrors, and must never be more permissive than it.
- `renderWithProviders` for a component; `renderApp` for anything about routing (real generated route tree on a memory history). Every dependency is passed, never `vi.mock`ed.
- Query by **role and accessible name**. A control the suite cannot name is one a screen reader cannot name.
- Cover: config-versus-contract, the URL↔query round trip, form validation and server-error placement, the submit lock, and each session state (bootstrapped, expired-and-refreshed, terminal).

## Commands

```
pnpm dev --filter admin          # http://localhost:3001 (needs the API on 4000)
pnpm test:unit --filter admin    # cached, no database
pnpm lint && pnpm check-types && pnpm test
```
