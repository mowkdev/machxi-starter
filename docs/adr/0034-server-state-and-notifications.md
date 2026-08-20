# ADR-0034: Server state and notifications — TanStack Query conventions and sonner

- Status: accepted
- Date: 2026-08-19

> One of the D3 (admin panel) decision set, written together with ADR-0030–0033, 0035 and 0036 before the first screen exists. `D3.5` is the planned implementing step. It stays amendable in place while D3 is `in progress` in `docs/plan/README.md` (ADR-0025 rule 2).

## Context

The admin panel is a CRUD client over an API whose contracts are already decided: one envelope ([ADR-0012](0012-response-envelope.md)), one list-query language whose schemas live in `@repo/contracts` ([ADR-0014](0014-pagination-filtering-sorting.md) — `listQuerySchema`, and per-module schemas like `listStaffQuery`), and one machine-readable error union (`ErrorCode` in `packages/contracts/src/errors.ts`, [ADR-0013](0013-error-model.md)). Almost everything the panel renders is a cache of that API, and caches of remote data have a known set of problems — request deduplication, staleness, refetching, invalidation after writes, loading and error states — that are solved badly by hand with `useEffect` + `useState` and solved worse by copying server rows into a store.

Two forces sharpen this beyond "pick a fetching library".

**The list-state contract already exists and must not be re-invented.** ADR-0014 defines `offset`, `limit`, `sort`, `filter[...]` and `q` once, in zod, in a package with no server dependency — precisely so that "an admin table needs them to type a list response" (its own words). A grid whose page/sort/filter state lives in component state, in a shape the frontend made up, throws that away: the state dies on navigation, cannot be shared as a link, and drifts from what the API validates. ADR-0032 gives the router typed, zod-validated search params; the seam between the two is this ADR's to decide.

**Mutation outcomes need a policy, not a habit.** Every create, update and delete has an outcome the user must see. Without a convention, `toast()` calls accumulate at call sites — some mutations toast, some do not, wording is ad hoc, error toasts duplicate the inline errors a form already shows, and there is no single place to test any of it. The error union was designed for exactly this ("codes are the i18n key; `message` is a developer-facing English default" — ADR-0013), and nothing on the client uses it that way yet.

## Decision

### One owner for server state

**TanStack Query v5 owns all server state.** Anything fetched from the API lives in the query cache and nowhere else: no server data in React state, in context, or in any store. Client state is only what ADR-0033's session store holds (the access token, the authenticated principal) and local component state (an open dialog, an uncommitted input). The test for "is this server state?" is: could another user change it, or could a refetch return something different? If yes, it belongs to the cache.

This is a prohibition worth stating because the failure mode is gradual: one `useState(users)` to "avoid a refetch" becomes a second source of truth that invalidation cannot reach.

### Query keys — per-entity factories, keys are data

Each entity slice (FSD, ADR-0032) exports one key factory. **No inline key arrays at call sites**, ever — a key written twice is an invalidation that misses.

```ts
// entities/staff/api/staff.keys.ts
import type { ListStaffQuery } from "@repo/contracts";

export const staffKeys = {
  all: ["staff"] as const,
  lists: () => [...staffKeys.all, "list"] as const,
  list: (params: ListStaffQuery) => [...staffKeys.lists(), params] as const,
  details: () => [...staffKeys.all, "detail"] as const,
  detail: (id: string) => [...staffKeys.details(), id] as const,
} as const;
```

Keys are hierarchical data, not strings, and invalidation targets prefixes: `invalidateQueries({ queryKey: staffKeys.lists() })` hits every page/sort/filter permutation of every staff list without naming any of them. The params object inside `list(params)` is the *parsed* query — TanStack Query hashes keys structurally, so two parameter objects that mean the same request are the same cache entry regardless of property order.

### List state lives in the URL

A grid's offset, limit, sort and filters are **route search params, not component state**. The route validates its search with the same `@repo/contracts` schema the API validates the request with — TanStack Router's `validateSearch` takes a zod schema (ADR-0032), and the module's list schema (`listStaffQuery`) already is one. The query key is then derived from the validated search:

```ts
// entities/staff — the hook; the route supplies validated params
export const useStaffList = (params: ListStaffQuery) =>
  useQuery({
    queryKey: staffKeys.list(params),
    queryFn: () => listStaff(params),
    placeholderData: keepPreviousData, // pagination does not flash empty
  });
```

What this buys, in order of importance: the parameter names and the **parsed** shape (`LIST_QUERY_PARAMS`, the nested filter record) are defined **once**, in contracts, and reused by API validation, router search validation and the query key — a divergence is a type error, not a bug report. Every grid state is a deep link; back/forward walks table states because navigation *is* the state change. And the cache falls out correctly: same URL, same key, same entry.

Said precisely, because two serializations are in play and only the parsed shape is shared: the `filter[field][op]` **bracket syntax is the wire form** — produced by an axios `paramsSerializer` the ADR-0033 client configures once, consumed by Express's query parsing on the API side — while the **app's own URL** uses TanStack Router's search-param serialization of the same parsed shape. The two need not match; the contract is the zod-validated object between them, and `D3.5` pins the serializer so no call site ever builds a query string by hand.

**Amended 2026-08-20 (D3.5): the route validates `listQuerySearchSchema`, not the endpoint's own builder.** §47 above says to give `validateSearch` the module's list schema, and §61 says the app's URL holds *the parsed shape*. Both cannot be true: `listStaffQuery` parses the **wire** form and outputs the **parsed** one (`sort: string` in, `sort: SortSpec[]` out; `filter` in, `filters` out, under a `strictObject`), and TanStack Router round-trips its validated output back into the URL on every navigation. Handed its own output the builder rejects it — `listStaffQuery.safeParse(listStaffQuery.parse({}))` fails, verified rather than reasoned — so the first pager click would have written a search the schema refused, and a `.catch` would have turned that into a silent reset to page one. That is the "state dies on navigation" failure §Context exists to prevent, arriving through the fix for it.

`@repo/contracts` therefore gains `listQuerySearchSchema` (D3.5), which validates the parsed shape and round-trips. It checks *shape*, not allow-lists: an endpoint's `sortable` and `filterable` sets are enforced by `listQuerySchema` when the request reaches the API, and by ADR-0035's config-versus-contract tests before that, so restating them in the router would be a second place to keep them aligned. The client-side wire serializer §61 promises is `apps/admin/src/shared/api/list-params.ts`; a `Date` filter value is written as an ISO-8601 instant, because ADR-0014's step-7 amendment makes the parsed value the column's own type and `String(date)` is locale- and timezone-dependent.

This is the seam ADR-0035's `AppGrid` plugs into — the grid reads validated search, renders `meta.pagination` / `meta.sort` / `meta.filters` from the envelope (ADR-0012 emits them so clients need not re-parse their own query), and writes state changes as navigations.

**Amended 2026-08-20 (D3.8).** The URL carries **deviations from the defaults, not the whole state.** As first built, every navigation serialised the full validated object, so page one at the default size read `/staff?offset=0&limit=20&sort=[]&filters=[]` — four parameters saying nothing. The list routes now run TanStack Router's `stripSearchParams` middleware, fed the schema's **own** `parse({})` output (`listSearchDefaults` in `shared/grid/list-state.ts`): a param equal to its default is stripped from every built link, and `/staff` *is* the canonical first page. Deriving the strip values from the schema rather than restating them is the load-bearing choice — the schema stays the single owner of what "default" means, so the two cannot drift. Nothing downstream changes: `useSearch` still yields the full validated object, the query key still derives from it, and a deep link that spells the defaults out parses identically and normalises to the bare path on the next navigation. The pager's size options became configurable in the same change — `AppGrid.pageSizes`, defaulting to 10/20/50/100 bounded by `MAX_LIMIT`, and always offering the current `limit` because the URL is user-writable and a select whose value is not among its options displays nothing.

### QueryClient defaults — decided, not defaulted

The library's defaults assume a generic app; this one is an admin panel over a low-collaboration dataset, and the defaults are chosen for it, in one `create*` wrapper (ADR-0009 — third-party constructors are wrapped):

```ts
// app/query-client.ts
export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) =>
          isApiClientError(error) ? false : failureCount < 2,
      },
      mutations: { retry: false },
    },
    mutationCache: createNotifyingMutationCache(), // §Notifications
    queryCache: createNotifyingQueryCache(),
  });
```

- **`staleTime` ~30 seconds.** The default of `0` marks everything stale immediately, so every window focus and every remount refetches — a refetch storm that buys nothing when the data is admin CRUD that mostly changes because *this* user changed it (and mutations invalidate explicitly, below). Thirty seconds of acceptable staleness is the same judgement ADR-0014 made server-side when it let `total` come from a second, non-transactional query: "an admin table showing a count one insert stale is not a correctness problem."
- **Never retry a 4xx.** An `ApiClientError` carrying a code (ADR-0033) is an *answer* — the server parsed the request and refused it — not a flake. Retrying a `403` three times triples load and delays the real feedback. Network failures and 5xx get up to 2 retries.

  **Amended 2026-08-20 (D3.5): the predicate discriminates on `status`, not on `isApiClientError`.** The snippet above was written before [ADR-0033](0033-browser-api-client-and-session.md)'s D3.4 amendment pinned `TRANSPORT_ERROR_CODE`, and that amendment made *every* rejection out of the client an `ApiClientError` — a dead socket included. So `isApiClientError(error) ? false : failureCount < 2` is constantly false: it retries **nothing**, the second clause is unreachable, and the only things that could reach it are bugs (a `TypeError` in a mapper), which it then retries twice. The rule as intended is `isApiClientError(error) && error.status >= 400 && error.status < 500 ? false : failureCount < 2`, which retries transport failures (`status: 0`) and 5xx and refuses to retry an answer.
- **Mutations never retry.** A write whose response was lost may have been applied; replaying it automatically risks doing the thing twice. The user retries deliberately, from the error toast.

### Entity API functions and hooks

Each entity slice owns its API surface: plain typed functions over ADR-0033's client, returning `@repo/contracts` resource types — no fetch logic in components, no ad hoc response shapes.

```ts
// entities/staff/api/staff.api.ts — plain functions, no hooks
export const listStaff = (params: ListStaffQuery): Promise<Page<StaffResource>> => …
export const getStaff = (id: string): Promise<StaffResource> => …
export const createStaff = (body: CreateStaffBody): Promise<StaffResource> => …

// entities/staff/api/staff.queries.ts — hooks wrapping them
export const useStaff = (id: string) => useQuery({ queryKey: staffKeys.detail(id), queryFn: () => getStaff(id) });
export const useCreateStaff = () => useMutation({ mutationFn: createStaff, /* meta + invalidation below */ });
```

The split matters for ADR-0036: the plain functions are testable without a React tree, and route loaders (ADR-0032) can call `queryClient.ensureQueryData` with the same key + function pair the hook uses.

**Amended 2026-08-20 (D3.5).** The paths above show an `api/` directory inside each slice; the implementation is flat — `entities/staff/staff.keys.ts`, `staff.api.ts`, `staff.queries.ts` — which matches the `<module>.<layer>.ts` naming ADR-0009 established on the API side and keeps one convention across the repository. The message map lives in `shared/notifications/messages.ts` and the `meta` type augmentation in `shared/api/query-meta.ts`, both in `shared` rather than beside the query client: `entities` and `features` write `meta` and may need `messageForError` for a form-level message, and ADR-0032 forbids either importing from `app`.

### Invalidation — the boring convention

A mutation invalidates its entity's `lists()` prefix and the touched `detail(id)`. That is the whole rule, and every CRUD mutation follows it:

```ts
export const useUpdateStaff = () =>
  useMutation({
    mutationFn: updateStaff,
    meta: { success: "Staff member updated." },
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: staffKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: staffKeys.detail(id) });
    },
  });
```

**Amended 2026-08-20 (D3.7): a mutation that writes a different aggregate invalidates nothing, and that is the rule holding rather than bending.** "Every CRUD mutation follows it" is exact, and the word doing the work is _its_ — a mutation invalidates **its entity's** keys. `POST /admin/staff/:id/sessions/revoke` writes only `sessions`, an aggregate this app does not cache and has no key factory for; the `staff` row is untouched, so there is no key of that entity's to invalidate and an `invalidateQueries` there would be a refetch that can only ever return what is already on screen. The test to apply, and the one that keeps this from becoming a licence to skip invalidation: **does the response of any cached query change because of this write?** For the sibling case it plainly does — `POST /:id/password` sets `updatedAt` on the row (ADR-0027), so the administrative reset invalidates `lists()` and `detail(id)` exactly like an update, despite carrying no resource field in its body.

**Amended 2026-08-20 (D3.9): when a write changes *another* entity's row, the invalidation belongs to the feature.** "A mutation invalidates its entity's keys" is the rule, and `PATCH /admin/profile` is the first write it does not cover: the acting operator is also a row in `/admin/staff`, so a rename leaves that row's names stale and a change-password leaves its `updatedAt` stale — the D3.7 test answers "yes" in both cases. The entity cannot fix it, and the reason is [ADR-0032](0032-admin-app-architecture.md) rather than taste: an entity may import from `shared` and nowhere else, so `entities/profile` cannot see `staffKeys`. A **feature** may import any entity slice, and it is already the layer that owns the interaction — so `features/profile-manage/use-invalidate-own-staff-row.ts` invalidates the staff prefix after both writes, three lines at a layer the dependency rule already permits. The general form: **the mutation invalidates its own entity; the feature invalidates whatever else its interaction touched.** A cross-entity invalidation *vocabulary* — entities declaring what they are downstream of — stays unbuilt, and the second case of this is what should justify it.

**Amended 2026-08-20 (D3.7): a mutation whose _variables_ are a credential sets `gcTime: 0`.** TanStack Query keeps a settled mutation, including the variables it was called with, in the mutation cache for `gcTime` — five minutes by default. So a password submitted through `mutateAsync` outlives the dialog that collected it, the `reset()` that cleared it and the unmount that removed it. Nothing reads it, and the point is that nothing _can_: this is ADR-0033's memory-only posture applied to the one other place a plaintext credential comes to rest.

**Amended 2026-08-20 (D3.9): one definition, and one test that can see it.** By the third credential mutation the option had been written three times, once per entity, because ADR-0032 stops one entity importing another's copy — and deleting any of them is a silent change that leaves the suite green while both plaintexts sit in `getMutationCache()`. `CREDENTIAL_MUTATION` now lives in `shared/api/credential-mutation.ts`, the layer every entity may reach, and `renderWithProviders` returns the query client so a test can assert the cache is empty once the dialog has settled. A security property that no test can observe is a comment.

**Optimistic updates are deliberately not the default.** This is a server-authoritative CRUD panel on a low-latency API: the rollback bookkeeping (`onMutate` snapshot, cancel in-flight queries, restore on error) buys a few hundred milliseconds of perceived speed and costs a class of bugs where the screen briefly showed a state the server rejected. This is a default with an escape hatch, not a ban — a feature where UX demands immediacy (e.g. toggling a flag in a long list) may opt in, and when it does, the full pattern, not a partial one.

### Notifications — sonner, attached declaratively via `meta`

The toast component is **sonner**, shipped from `@repo/ui` (ADR-0031); `<Toaster />` is mounted **once**, in the app layer, next to the providers.

The attach point for mutation outcomes is **declarative**: the global `MutationCache` / `QueryCache` callbacks read each operation's `meta`, so a mutation states its outcome and never calls `toast()` itself.

```ts
// A mutation declares its outcome…
useMutation({ mutationFn: createStaff, meta: { success: "Staff member created." } });

// …and one global handler delivers all of them.
export const createNotifyingMutationCache = () =>
  new MutationCache({
    onSuccess: (_data, _variables, _context, mutation) => {
      if (mutation.meta?.success) toast.success(mutation.meta.success);
    },
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.errorToast === false) return;
      toast.error(messageForError(error)); // ApiClientError.code → message map
    },
  });
```

- **Error toasting is automatic and needs no declaration.** The handler maps `ApiClientError.code` (ADR-0033) through **one message map keyed by the `@repo/contracts` `ErrorCode` union**. Typing it `Record<ErrorCode, string>` makes the compiler enforce what ADR-0013 designed for: a new code added to contracts fails the admin build until someone writes its message. This is the i18n seam — codes are the catalogue key; swapping the map for a locale-aware catalogue later changes one file. At runtime an unrecognised code (an older bundle against a newer API) falls back to a generic message, which is exactly what contracts tells clients to do.

  **Amended 2026-08-20 (D3.9): the seam is per *kind* of copy, and there are two kinds.** "Codes are the catalogue key" is right about codes and silent about the other half, which is why `applyServerErrors` rendering a validation detail's own `message` looked like an unmapped second source of operator copy — flagged in `D3.7`, deferred through `D3.8`, decided here. It is not a second source. A detail carrying a `path` is a zod issue from a `@repo/contracts` schema (`toErrorDetails` in the API copies `issue.message` unchanged), and that schema is the *same* object the form validated with on the way in (ADR-0011/0023) — so the sentence shown is the one the client would have shown had it caught the rule first, and mapping it here would make one rule read two ways depending on which side noticed it. **Codes are catalogued in `ERROR_MESSAGES`; field rules are catalogued in the schema that defines them**, and localising the second kind is a zod error map on the contracts package, applied once for both sides, rather than a per-field table in this app that could drift from the rule it describes. Two checks keep it honest rather than one convention: `applyServerErrors` renders a detail's own words only when the error's code is `VALIDATION_ERROR` — the D3.9 review's finding, because "only zod sets a `path`" is true of the API today and enforced by nothing, and `AppError` takes arbitrary `details` — and only when the field is one this form renders. Everything else falls through to this map. The residual the argument genuinely does not cover, recorded rather than glossed: a form whose *state is not its body* (the D3.8 transform) can be told about a key its controls never held, and zod's own type message for it is a sentence the client-side resolver would never have produced. It still lands somewhere visible; it is just not a sentence the operator has seen before.
- **Queries are silent unless they ask** (`meta: { errorToast: true }`), which is the mirror of the mutation rule and **amended in 2026-08-20 (D3.5)** because the snippet above showed `queryMeta.errorToast` without saying what the default is. The justification for automatic mutation toasts — "the failure always matters" — is untrue of a read: a failed list has an error panel in the place the data would have been, and a background refetch failing must not interrupt an operator mid-sentence. So `queryMeta.errorToast` is typed `?: true` rather than `?: boolean`, because an opt-*out* on a channel that is already silent would be a no-op that reads like a decision.

  **Amended 2026-08-20 (D3.7): "an error panel in the place the data would have been" is a requirement on the surface, not a hope about it.** The sentence above is the *whole* justification for a silent channel, and D3.7's review found the first grid shipping without the panel it presumes: `AppGrid` rendered its loading skeleton whenever it had no page, the ADR-0034 retry policy short-circuits a `4xx`, and so a `403` from the admin segment's `authorize` mount — the one refusal ADR-0019 says the client must not pre-guess — arrived as five placeholder rows that never resolved and no message anywhere. `AppGrid` now takes the query's `error` and renders it, with a retry, in the table body. The rule this fixes into place: **a surface that reads may not opt into silence unless it renders its own failure.** The stale-page case stays silent deliberately — `keepPreviousData` means a failed *refetch* still has a real page on screen, and replacing an operator's view with an apology is the interruption this bullet refuses.
- **`meta: { errorToast: false }` opts out** where a form renders the error inline. The division of labour with ADR-0035's forms: **field-level errors belong to the form** (a `VALIDATION_ERROR`'s `details`, an `emailTaken` conflict mapped onto its field), **operation-level outcomes belong to toasts**. A form that shows "email already in use" under the field suppresses the toast; a delete triggered from a row menu, with no form to speak through, relies on it.
- **`meta` is typed, not stringly-typed**, via TanStack Query's `Register` interface (module augmentation), so `meta: { succes: "…" }` is a compile error and the convention is discoverable from the type:

```ts
declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: { readonly success?: string; readonly errorToast?: boolean };
    queryMeta: { readonly errorToast?: boolean };
  }
}
```

**No per-callsite `toast()` sprinkling for CRUD outcomes** — that is the anti-pattern this section replaces. Direct `toast()` remains available for genuinely local, non-mutation notices (a "copied to clipboard", a client-side warning); those are not operations and have no `meta` to speak through.

### What this does not decide

- **The grid and form components themselves** — ADR-0035, which consumes the list hooks and the inline-error division defined here.
- **The API client, `ApiClientError`, and token refresh** — ADR-0033. This ADR assumes a client whose failures carry a contracts `ErrorCode`.
- **Websocket / server-push invalidation.** Nothing pushes; staleness is bounded by `staleTime` and mutation invalidation. A future collaborative feature would revisit `staleTime` per query, which the defaults above deliberately leave overridable.

## Consequences

- **One list-state contract, three consumers.** Every list endpoint's params and serialization are defined once in `@repo/contracts` and reused by API validation, router search validation and query keys. Drift between what a grid sends and what the API accepts becomes a type error — the strongest property this decision buys, and the reason list state may not live in component state.
- **The message map is a chore with a compiler behind it.** One file must stay aligned with the `ErrorCode` union; `Record<ErrorCode, string>` makes a gap a build failure, and the file is greppable and lint-able. It is also the single place i18n will land.
- **Toast behaviour is testable in one place** (ADR-0036): the cache callbacks are functions taking an error and a `meta`, so "a `STAFF_LAST_SUPER_ADMIN` failure toasts its message" and "`errorToast: false` suppresses it" are unit tests, not per-screen assertions.
- **The convention is discoverable from types.** `Register` augmentation means autocomplete on `meta` teaches the pattern; the key factories mean "what do I invalidate?" has one answer per entity.
- **Staleness is now a stated number.** For up to ~30 seconds, a change made by *another* admin is invisible until focus/refetch. Accepted for the same reason ADR-0014 accepted a stale `total`; a screen that cannot tolerate it sets its own `staleTime`.
- **Follow-up:** when i18n arrives (Planned, ADR index), the message map becomes the extraction point — success strings in `meta` will need the same treatment (a key rather than English text), which is an amendment to this ADR if D3 is still open, a superseding one if not.

## Alternatives considered

- **RTK Query or SWR.** Fine tools solving the same problem. RTK Query drags in a Redux store this app otherwise has no need for; SWR is lighter but weaker on mutations and structural key invalidation. TanStack Query pairs with TanStack Router's loader/`context` integration (ADR-0032), which is where `ensureQueryData` on navigation comes from.
- **Redux (or any store) as the server cache.** The classic shape: fetch in a thunk, normalise into slices, select back out. It re-implements staleness, deduplication and invalidation by hand — the exact machinery TanStack Query ships — and history says it is re-implemented worse.
- **Per-mutation `onSuccess`/`onError` callbacks for toasts, everywhere.** Works, and every call site restates the policy: which errors toast, what wording, whether the form already showed it. The `meta` pattern keeps the *declaration* local and the *policy* global, which is the difference between convention and habit.
- **shadcn's old `toast`/`useToast`.** Superseded by sonner in shadcn itself; adopting a deprecated pattern into `@repo/ui` on day one would be a decision made backwards. ADR-0031 owns the component; this ADR only depends on there being one `<Toaster />`.
- **A global error boundary only.** Boundaries catch render-time failures and show a fallback screen; they cannot say "that particular delete failed because the account is the last super admin" while the rest of the page stands. Per-operation messaging needs the operation, which is what the mutation cache has and a boundary does not. Boundaries remain in play for render errors — a different failure class, out of this ADR's scope.
