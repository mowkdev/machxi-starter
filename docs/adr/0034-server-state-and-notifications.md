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

This is the seam ADR-0035's `AppGrid` plugs into — the grid reads validated search, renders `meta.pagination` / `meta.sort` / `meta.filters` from the envelope (ADR-0012 emits them so clients need not re-parse their own query), and writes state changes as navigations.

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
