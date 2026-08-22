---
name: frontend-conventions
description: Quick reference of the machxi admin-app conventions (FSD layers, design system, session, server state, resource UI, the v2 data grid, localization, testing) condensed from ADRs 0030-0046. Load before writing or reviewing any code under apps/admin or packages/ui.
---

# Frontend conventions (condensed from docs/adr — ADRs win on conflict)

ADRs 0030–0036 (D3), 0037–0042 (D4), 0043–0044 (D5), 0045 (D6) and 0046 (D7, **in progress** — accepted at the head of `D7.1` and amendable while D7 is open; 0030–0045 are frozen).

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

- **Credentials live in memory only.** No access token, CSRF token or principal in `localStorage`, `sessionStorage` or a client-set cookie; the client never _reads_ `document.cookie`. Non-credential display state may be persisted, and there are three: the theme, the sidebar's cookie, and ADR-0041's grid preferences. A fourth cites the same carve-out rather than treating persistence as normalised. Since ADR-0045 the theme and the grid preferences are **account** facts held server-side, and `localStorage` is the cache in front of them — the carve-out still describes what may sit on the device, not who owns the value.
- Boot: `GET /auth/csrf` → `POST /auth/refresh`; the app renders nothing until it resolves. A failed refresh is `anonymous`; a failed bootstrap is "API unreachable" and is shown.
- One axios instance in `shared/api/client.ts`: bearer on every request, CSRF header on the three guarded paths, `X-Auth-Transport: cookie` on login/refresh, **single-flight** refresh on `401`, one bounded retry each for `401` and `403 CSRF_TOKEN_INVALID`, terminal codes end the session. Absolute URLs are refused.
- `client.ts` is the only writer of tokens. `useSetPrincipal` is the one narrow exception, for a profile rename.
- Failures are `ApiClientError` carrying a contracts `ErrorCode`; nothing branches on status alone.
- `apps/admin/.env` is its own file. Everything `VITE_*` is compile-time public — nothing secret, ever.

## Server state (ADR-0043, superseding ADR-0034)

- **TanStack Query owns all server state**; component state owns nothing a server sent.
- Query keys come from a per-entity factory (`staffKeys.list(params)`). Never inline a key array.
- **List state lives in the URL, spelled in the API's own query language** (0043). `validateSearch: listQuerySearchSchema`, `stripSearchParams(listSearchDefaults)`, and the parsed search _is_ the query key — all unchanged. What changed is the characters: there is **one serialization**, `@repo/contracts`' `stringifyListSearch`/`parseListSearch`, used by both the axios `paramsSerializer` and the router's `parseSearch`/`stringifySearch`. So `/staff?offset=40&sort=-email&filter[status]=active` is what the address bar shows **and** a valid query string for `GET /api/v1/admin/staff`. Brackets are written literally; a `like` pattern's `%` stays `%25`.
  - The codec is installed on the **router**, never on a route, because `validateSearch` must round-trip its own output (the `D3.5` finding). It touches only the names `LIST_QUERY_PARAMS` defines and delegates the rest, so `/login?redirect=…` is untouched.
  - Test it **at the seam** — apply through the UI, read `router.state.location.searchStr`, mount a fresh router at that URL. A codec round trip alone is what `D4.7` proved insufficient.
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
- Server failures: `applyServerErrors(error, form.setError, { fields: <this variant's names>, codeFields, messageForError })`. It lands a `VALIDATION_ERROR` detail on its field verbatim (the detail's words are the contract's) and everything else at the form level through the code catalogue. `messageForError` comes from `useMessageForError()` and is **required** since `D7.2` — a defaulted English would be a form whose fields are translated and whose form-level failure is not.
- Operator-facing copy: **codes** are catalogued in `shared/i18n/locales/en/errors.json`, keyed by `ErrorCode` (`D7.2` — the old `Record<ErrorCode, string>` moved, and its compile-time completeness moved with it to `shared/i18n/__checks__/errors.ts`, so a new code still fails `check-types` until someone writes a sentence); **field rules** are catalogued in the contracts schema. The API's own `error.message` is never rendered.

## The data grid, v2 (ADRs 0037–0042)

Everything below is additive over ADR-0035; the config is still data and the server still owns every data operation.

- **The shell (0037).** A grid page opts in with `staticData: { fullHeight: true }`, and **every wrapper from the page container down to `AppGrid` carries `flex flex-col flex-1 min-h-0`** — one missing link and the budget reverts to document scroll and the sticky header comes unstuck. Nothing on that path may clip: an `overflow-hidden` that looks tidier silently eats the pager on a short viewport. One scroll container, sticky header, static pager, `min-h-64` floor, and below the floor the page scrolls rather than the grid crushing.
- **Record surfaces are routes (0044, superseding 0040).** `/<x>/new` and `/<x>/$id`, detail data through the route loader (`ensureQueryData` on the entity's own `detail(id)` key). **A record URL carries only the record** — no `retainSearchParams`, nothing after the id. The list state travels as **history state** through `shared/grid/record-navigation` (`openState` at the entry point, `closeSearch` on every close), which survives reload and Back and is absent for a cold link, so a record someone sent you closes to the bare list. The grid behind a dialog or drawer reads `useCarriedListState`, **not `useSearch` alone** — the parent's search while a record is open is the record URL's, so reading it directly floats the overlay over page one of everything. The list route needs an **index leaf the grid does not live on**, or opening a dialog unmounts the grid behind it. `grid.editSurface: "dialog" | "drawer" | "page"` picks the shell and **the URL is identical across all three**. Destructive confirmations and the password ceremony stay ephemeral component state on purpose — a URL must not reopen a "confirm delete".
- **Capabilities (0038) and `can()` (0042) are different questions.** `grid: { selectable, canCreate, canEdit, canDelete, canBulkDelete }` says what _this surface offers_; `useAllowedCapabilities(config.grid, "<resource>")` conjoins it with the operator's role **once per screen**, so `shared/grid` never learns a resource name. The API's guards remain the enforcement — none of this is a security boundary. Containment actions (reset password, sign out everywhere, and the edit form that hosts disabling) render for everyone deliberately: a hidden break-glass control during an incident is worse than a refused one. Bulk delete is a feature-owned `Promise.allSettled` fan-out — bounded concurrency, stops dead on `RATE_LIMITED`, one summary with per-item refusals.
- **Filters (0039).** There is no filter row. A column that declares a `filter` gets a **header icon opening a dialog that commits on Apply**; `grid.hotFilters` are toolbar stances, `enum` or `presence` only, because a button is a choice and not a composition surface. The applied-filters bar renders **from the URL's validated filters, never from the column configs** — configs contribute labels, never membership — so a deep-linked filter on a field no column owns still shows and still clears. A chip is suppressed exactly while a hot-filter button displays the same entry.
- **Preferences (0041).** `gridId={config.name}` turns on column sizing, order and visibility. The taxonomy is the rule to cite when new grid state asks where it lives, and `D5.3` made it three-way: **the URL owns _view_ state, preferences own _ergonomics_, history state owns _the way back_, and the table owns nothing durable.** Sizing never enters a link — a shared view must not impose the sender's column widths on the receiver. Storage is behind a three-function adapter; the value is versioned, bounded and reconciled against the config on read, so a column rename is never a migration. The schema itself now lives in `@repo/contracts` and is re-exported from `shared/grid/preferences.ts` (0045).
- **Settings are the second adapter behind that seam (0045).** `entities/settings` owns the account's `theme`, `locale` and `grids`; `createServerPreferenceAdapter` implements the same three `PreferenceStorage` functions over an in-memory mirror seeded by the settings query, and one debounced writer coalesces every change into a single `PATCH /settings`. It is supplied through `PreferenceStorageProvider` in `shared/grid`, so **`createGridPreferences` and `AppGrid` did not change and must not**. The adapter owns the `machxi.admin.grid:<gridId>:v1` ↔ `grids[gridId]` mapping; the store never learns a `gridId` is on the wire. Signed out, the local adapter is used alone — read that from the **session**, not from whether the query has data. A local-only entry is adopted on its first read and uploaded once; a server entry wins; an entry either schema refuses is discarded rather than repaired, on the device and on the wire.
- **Structural columns are the grid's, not the resource's.** The selection checkbox and any column whose `cellRenderer` is `rowActions` are pinned first and last by `AppGrid`, absent from the Columns menu, and never hidden, reordered, resized or stored.

## Localization (ADR-0046, D7 — in progress)

- **`shared/i18n` is the seam, and `createI18n` is a factory** — never a module-level singleton. `app/providers/i18n.tsx` builds one instance inside `SettingsProvider` and hands it to `I18nextProvider`; the harness builds its own per render. D8 lifts the module into a package unchanged, so nothing under it may learn which app mounted it.
- **Locale precedence, in order: the account's `settings.locale` → `localStorage` `machxi.admin.locale` → `navigator.languages` → `en`.** `lv-LV` matches `lv` by primary subtag; anything else is **not guessed at**. `Accept-Language` is used nowhere, by either side. The pure half is `resolveInitialLocale` and it is table-tested.
- **`en` is bundled eagerly** — it is the fallback, the type source and the locale the suite runs in — and every other locale is one dynamic `import()` per `<locale>/<namespace>.json`. No `public/locales`, no runtime fetch: catalogues are code.
- **Keys are typed, and configs carry them (`D7.4`).** `types.d.ts` declaration-merges the `en` catalogue into `CustomTypeOptions`, so a missing or misspelled key is a `check-types` failure. A `ResourceConfig`'s `header`, `label`, `description`, `placeholder` and filter labels, a route's `staticData.title`, a mutation's `meta.success` and `AppGrid`'s `emptyMessage` are all `TranslationKey`s — **a key is data**, so ADR-0035's config-is-serializable rule is unmoved. The rendering machinery resolves them with **`useKeyT()`** (`TranslateKey`, every namespace), never a namespace-bound `useT("x")`, because `shared/*` may not learn which resource it is drawing. A module whose copy is all one namespace's keeps `useT("grid")`; a module that resolves keys **it did not write** takes the app-wide one and prefixes its own (`t("grid:chip.is")`).
- **One `locales/` tree, one namespace per slice, and the namespace name _is_ the slice name.** Ten of them since `D7.4`: `common`/`grid`/`form`/`errors` are the cross-cutting four that belong to `shared/*`, and `auth`/`dashboard`/`profile`/`staff`/`users`/`settings` belong to the slices they are named for (`settings` holds theme and locale copy). A `staff:` key used in `features/users-manage` is a review finding — lint cannot see a string prefix, and ADR-0046 says so rather than pretending it can.
- **An enum value's label is `common:options.<value>`, composed at runtime** (`optionLabel`, `dynamicKey`) with `humanize` as the fallback — the one composed key in the app, because `StatusBadge` and `RolesList` get a cell value and no config, and because spelling the members out would copy a contracts tuple ADR-0023 declares once. Each config test asserts every option it declares has a catalogue entry; the compiler cannot.
- **A namespace that is not the app's is declared through `ResourceNamespaceMap`, never `CustomTypeOptions`** — the test fixture already does it (`src/test/fixtures/demo-i18n.d.ts` + `addResourceBundle` in the harness), and it is the rule D8's extracted packages follow.
- **`en` means en-GB**, and `INTL_TAGS` (`en → en-GB`, `lv → lv-LV`) is the only place a locale becomes a formatting tag. `<html lang>` carries the tag. Never `toLocaleString()`/`toLocaleDateString()` with an implicit locale anywhere in `apps/admin`.
- **Steps after `D7.1` are what fills it.** `D7.2` (**done**) swept `shared` and `widgets` to zero literals, moved `ERROR_MESSAGES` into `errors.json`, and made every grid `Intl.DateTimeFormat` follow the active locale through `shared/i18n/intl.ts` — what is left in `app` is route titles and two "Back to <resource>" links, which are `D7.4`'s with the namespaces they need; `D7.3` (**done**) gave `@repo/ui` a `UiStrings` context — six English-defaulted strings injected through `@repo/ui/ui-strings` (on the `shared/ui` door, and in the `no-restricted-imports` group with it), fed from `common:ui.*` by `app/providers/ui-strings.tsx`, with the design system still naming no i18n dependency; `D7.4` (**done**) turned every config's copy into keys, landed the six per-slice namespaces and gave `shared/i18n` its `keys.ts` seam (`useKeyT`, `dynamicKey`, `createDeferredTranslate`); `D7.5` lands zod's error map and the switch; `D7.6` adds the lint rule, the extractor, the drift check and Latvian. The API is **untouched** by all of it.

## Testing (ADR-0036)

- Vitest + Testing Library + MSW (`msw/node`). **No live-API tier**; an unhandled request is an error.
- Handlers are built from `@repo/contracts` — parse the request with the schema the API validates with, answer through the envelope builders. A handler modelling a refusal names the service function it mirrors, and must never be more permissive than it.
- `renderWithProviders` for a component; `renderApp` for anything about routing (real generated route tree on a memory history). Every dependency is passed, never `vi.mock`ed. Both take a **`locale`, default `en` loaded synchronously**, and return the instance as `i18n` — assertions stay by English accessible name, which is what keeps the suite unmoved through D7.
- Query by **role and accessible name**. A control the suite cannot name is one a screen reader cannot name.
- Cover: config-versus-contract (columns **and** hot filters, every declared option), the URL↔query round trip, form validation and server-error placement, the submit lock, and each session state (bootstrapped, expired-and-refreshed, terminal).
- **Grid preferences are tested at two levels, and they use different storage on purpose.** The store's own suite runs against an in-memory `PreferenceStorage`, which is what the adapter seam is for; a _page_ suite exercises the real wiring (`gridId={config.name}` reaching the real adapter) and therefore writes real `localStorage` — so it clears `window.localStorage` in `beforeEach`, or one case's column arrangement is handed to the next and the file's result depends on its order.
- **Close an overlay before unmounting.** A test that unmounts with a Radix popover or dialog open leaves its dismiss layer mutating the document; nothing fails, and every `findBy*` after it re-scans a tree that never settles. It cost one file 656 s before anyone noticed (`D4.5`).
- jsdom has no layout, so **geometry is not testable here** — widths, wrapping, sticky positioning and scroll behaviour are the manual walk's, and the walk is what has caught every one of D4's layout defects.

## Commands

```
pnpm dev --filter admin          # http://localhost:3001 (needs the API on 4000)
pnpm check                       # fast loop: lint + check-types + test:unit, one cached parallel run
pnpm test:unit --filter admin    # admin's unit suite alone, cached, no database
pnpm lint && pnpm check-types && pnpm test
```
