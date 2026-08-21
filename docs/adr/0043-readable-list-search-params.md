# ADR-0043: Server state, notifications, and one query language for both the URL and the wire

- Status: accepted
- Date: 2026-08-21
- Supersedes: [ADR-0034](0034-server-state-and-notifications.md)

> One of the D5 (grid URL readability) decision set, written with [ADR-0044](0044-record-routes-without-list-state.md) on the day D5 opened. `D5.1` and `D5.2` are the implementing steps (`docs/plan/0005-grid-url-readability.md`). **Accepted 2026-08-21**, at the head of `D5.1` — the per-step acceptance D4 established (ADR-0025 rule 3). It stays amendable in place while D5 is `in progress` in `docs/plan/README.md` (ADR-0025 rule 2).
>
> **This record carries the whole of ADR-0034, not the delta** (ADR-0024 rule 1): its parent is out of force, and a reader must never have to assemble the current rule from two documents. Everything ADR-0034 decided about the query cache, invalidation and notifications is restated here unchanged, with its five amendments folded into the body where they belong. **One section changes**: §List state lives in the URL, and the sentence it drops is quoted in §Context so the change of mind is legible rather than silent.

## Context

The admin panel is a CRUD client over an API whose contracts are already decided: one envelope ([ADR-0012](0012-response-envelope.md)), one list-query language whose schemas live in `@repo/contracts` ([ADR-0014](0014-pagination-filtering-sorting.md) — `listQuerySchema`, and per-module schemas like `listStaffQuery`), and one machine-readable error union (`ErrorCode` in `packages/contracts/src/errors.ts`, [ADR-0013](0013-error-model.md)). Almost everything the panel renders is a cache of that API, and caches of remote data have a known set of problems — request deduplication, staleness, refetching, invalidation after writes, loading and error states — that are solved badly by hand with `useEffect` + `useState` and solved worse by copying server rows into a store. That much is settled and unchanged; ADR-0034 decided it, D3 built it, and D4 ran two grids on it for a deliverable without finding a seam in it.

**What changed is one sentence.** ADR-0034 §List state lives in the URL said, precisely:

> the `filter[field][op]` **bracket syntax is the wire form** … while the **app's own URL** uses TanStack Router's search-param serialization of the same parsed shape. The two need not match; the contract is the zod-validated object between them.

The reasoning was sound and the conclusion has aged badly, for a reason that only shows up once the URL is load-bearing. D4 made it exactly that, in three places: list state lives there ([ADR-0041](0041-grid-preferences.md) — "the URL owns view state, preferences own ergonomics, the table owns nothing durable"), record identity lives there ([ADR-0040](0040-record-routes-and-edit-surfaces.md)), and the applied-filters bar renders **from the URL and from nothing else** ([ADR-0039](0039-grid-filter-ux.md) — "the bar is the honest display of what the server was asked"). A URL that three decisions treat as the app's public state description is not an implementation detail of the router, and "need not match" quietly meant "will not match":

```
/staff?sort=%5B%7B%22field%22%3A%22email%22%2C%22direction%22%3A%22desc%22%7D%5D
      &filters=%5B%7B%22field%22%3A%22status%22%2C%22op%22%3A%22eq%22%2C%22value%22%3A%22active%22%7D%5D
```

`D3.8`'s `stripSearchParams` amendment addressed the _empty_ case — a bare `/staff` instead of four parameters saying nothing — and stopping there is what makes this worth its own record: the fix that made the default URL clean is the same fix that made the applied URL's ugliness feel decided.

Three forces make the JSON encoding actually costly, rather than merely unlovely.

**Two serializations mean two chances to be wrong, and only one of them is exercised by the API.** The wire writer (`shared/api/list-params.ts`) is checked continuously — every list request in every suite goes through it, and a mistake is a `VALIDATION_ERROR` from a real endpoint. The browser encoding is checked by nothing outside the app: a URL the app can read back is "correct" by definition, however it reads. The two shapes agreeing is a property nobody can test, because they are not supposed to agree.

**A URL an operator can read is a support tool.** "Send me the link" is how a grid state gets reported, and `?sort=-email&filter[status]=active` says what went wrong in the message itself. The same string pasted onto `/api/v1/admin/staff` is a valid API request, which turns "the grid shows the wrong rows" into a one-keystroke question about whether the client or the server is wrong.

**The good syntax already exists and is already written down.** ADR-0014 defined `offset`, `limit`, `sort=-createdAt`, `filter[field][op]=value` and `q` once, in zod, in a package with no server dependency — "precisely so that an admin table needs them to type a list response", in its own words. `serializeListParams` implements the writer. Nothing has to be designed here; something has to be _pointed at the router instead of only at axios_, and the missing half — a reader that produces the parsed shape rather than the API's `ListQuery` — has to be written.

One constraint shapes the mechanism and was learned the expensive way at `D3.5`, recorded in ADR-0034 and restated here because it is the reason this decision lands where it does: **TanStack Router round-trips its own validated search back into the URL on every navigation**, so `validateSearch` must be an involution. `listStaffQuery.safeParse(listStaffQuery.parse({}))` fails — the endpoint builder parses the wire form and _outputs_ the parsed one — which is why `listQuerySearchSchema` (the parsed shape, round-trippable) exists and why a route may not validate with an endpoint builder.

## Decision

### One owner for server state

**TanStack Query v5 owns all server state.** Anything fetched from the API lives in the query cache and nowhere else: no server data in React state, in context, or in any store. Client state is only what [ADR-0033](0033-browser-api-client-and-session.md)'s session store holds (the access token, the authenticated principal) and local component state (an open dialog, an uncommitted input, and ADR-0038's row selection, which is action context rather than view state). The test for "is this server state?" is: could another user change it, or could a refetch return something different? If yes, it belongs to the cache.

This is a prohibition worth stating because the failure mode is gradual: one `useState(users)` to "avoid a refetch" becomes a second source of truth that invalidation cannot reach.

### Query keys — per-entity factories, keys are data

Each entity slice (FSD, [ADR-0032](0032-admin-app-architecture.md)) exports one key factory. **No inline key arrays at call sites**, ever — a key written twice is an invalidation that misses.

```ts
// entities/staff/staff.keys.ts
import type { ListStaffQuery } from "@repo/contracts";

export const staffKeys = {
  all: ["staff"] as const,
  lists: () => [...staffKeys.all, "list"] as const,
  list: (params: ListStaffQuery) => [...staffKeys.lists(), params] as const,
  details: () => [...staffKeys.all, "detail"] as const,
  detail: (id: string) => [...staffKeys.details(), id] as const,
} as const;
```

Keys are hierarchical data, not strings, and invalidation targets prefixes: `invalidateQueries({ queryKey: staffKeys.lists() })` hits every page/sort/filter permutation of every staff list without naming any of them. The params object inside `list(params)` is the _parsed_ query — TanStack Query hashes keys structurally, so two parameter objects that mean the same request are the same cache entry regardless of property order.

### List state lives in the URL, in the API's own query language

A grid's offset, limit, sort, filters and search term are **route search params, not component state**. That half is ADR-0034's and is unchanged: the state survives reload, it is shareable as a link, back and forward walk table states because navigation _is_ the state change, and the cache falls out correctly — same URL, same key, same entry.

**What is new: there is one serialization of the list-query language, and both the browser URL and the wire use it.** The bracket syntax ADR-0014 defines is not "the wire form"; it is **the form**. `/staff?offset=40&limit=50&sort=-email&filter[status]=active&q=ann` is what the address bar shows, and it is a valid query string for `GET /api/v1/admin/staff` — the same characters, sent to the API, describe the same page.

#### The codec, and where it lives

`@repo/contracts` gains the language's reader and writer, beside the schemas that define it:

```ts
// packages/contracts/src/list-search.ts
export const stringifyListSearch = (state: ListSearchState): string => …  // → "offset=40&sort=-email&filter[status]=active"
export const parseListSearch = (search: string | URLSearchParams): Record<string, unknown> => …
export const isListSearchState = (params: object): params is ListSearchState => …
```

**Amended 2026-08-21 (D5.1).** Three details the implementation fixed, none of them a change of mind. The reader returns a **`Record<string, unknown>` of the keys actually present** rather than a bare `unknown`: "unvalidated" is the property that matters and it still holds, but a caller that has to merge non-list params around the result (a router, whose search is one object across every route) needs a bag it can spread, and an absent key is how the schema's own defaults get to apply. The writer's parameter is `ListSearchState`, which is `ListQuery` **widened on `q`** — `listQuerySearchSchema` infers `q?: string | undefined` from `.optional()` while `ListQuery` declares `q?: string`, and under `exactOptionalPropertyTypes` a route's validated search would otherwise not be writable by the same function that writes a parsed query. And the pair is a trio: `isListSearchState` is a structural predicate for the one caller that is handed both kinds of thing, an HTTP client's `paramsSerializer`, which has no way to be told which it has.

- **Contracts, not the app**, because this is the language's own vocabulary — `LIST_QUERY_PARAMS`, the operators, the `-` sort prefix — and a second consumer is coming (D8's customer app, over the same `listQuerySchema`). It stays inside [ADR-0023](0023-shared-contracts-package.md)'s one-dependency rule: this is pure string work over `URLSearchParams`, with zod nowhere in it.
- **`parseListSearch` returns `unknown`, deliberately.** It recovers _shape_ from characters; `listQuerySearchSchema` decides whether that shape is valid, exactly as it does today. A codec that validated would be a second place where "what a list query may contain" is defined, which is the duplication this whole ADR is about.
- **The pair is an involution and is tested as one.** `parse(stringify(state))` equals `state` — one property over a table of states, not two functions that look right separately. The three shapes a string cannot carry are recovered from the operator rather than guessed: `in` is a comma list, `null` is a boolean, and a bare `filter[x]=v` is `eq`, which is the shorthand ADR-0014 defines and the existing writer already emits.
- **Filter values are strings on the way back, and always were.** ADR-0014's step-7 amendment makes a parsed filter value the column's own type, and a `Date` is written as an ISO-8601 instant (`String(date)` is locale- and timezone-dependent, 60 characters long, and loses milliseconds). Nothing revives it on the way in — `filterSchema` types a scalar value as `z.unknown()` — and that is not a regression introduced here: the JSON encoding did not revive `Date`s either. It is pinned because the round-trip test would otherwise be written against an assumption that has never been true.

#### The canonical string

`stringifyListSearch` builds with `URLSearchParams` and then **writes `[` and `]` literally** rather than as `%5B` / `%5D`. Brackets are the one place where the encoder's default defeats the entire purpose of the decision: `filter%5Bstatus%5D=active` is not a readable URL, and browsers display, accept and preserve raw brackets in a query string. Percent-encoding them was never a decision — it is what `URLSearchParams.toString()` happens to do — and the two strings are the same query once decoded, which is checked against the API in `D5.1` rather than argued here. Everything else keeps the encoder's escaping untouched; in particular a `like` pattern's `%` stays `%25`, which is what makes ADR-0039's client-side escaping of an operator's literal `100%` survive the trip.

The reader accepts both spellings, because a hand-typed or copy-pasted URL may carry either.

#### The seam is the router, not the route

The codec is installed on the **router** — `createRouter({ parseSearch, stringifySearch })` — and no route changes:

```ts
// app/router.ts
createRouter({
  routeTree,
  context: { … },
  parseSearch: parseAdminSearch,      // list params via parseListSearch, the rest as TSR does
  stringifySearch: stringifyAdminSearch,
});
```

- **Because `validateSearch` must stay an involution.** The routes keep `validateSearch: listQuerySearchSchema` and keep holding the rich parsed object (`sort: SortSpec[]`, `filters: Filter[]`). Moving the wire shape into the route's search type instead would put strings in front of every consumer — the grid, the query key, ADR-0039's chips — and reintroduce the `D3.5` failure from the other side.
- **Because nothing downstream should know.** `useSearch` yields the same validated `ListQuerySearch` it yields today; the query key derives from the same object, so cache identity is unchanged; `listSearchDefaults` + `stripSearchParams` still strip a param equal to its default, so `/staff` remains the canonical first page; and the pure functions in `shared/grid/list-state.ts` are untouched. The change is a different set of characters for the same state.
- **The codec knows only the names `LIST_QUERY_PARAMS` defines** and delegates every other key to TanStack Router's default behaviour, so `/login?redirect=/staff` is unaffected and a future non-list search param needs no permission from this decision.

**Amended 2026-08-21 (D5.2).** Installing the codec on the router found one thing the §Decision above had not said, and it follows from a decision this ADR keeps rather than from a mistake. `stripSearchParams` runs **before** serialization, so what reaches `stringifySearch` on a list route is not a whole `ListQuerySearch` — it is **whatever survived the strip**: a grid on page one at the default size with one sort applied hands the writer a single key. The writer therefore **writes the keys it is given and no others**, which is what lets one function serve both a full parsed query (axios, where every key is present) and a router's remainder. Restoring `offset=0&limit=20` around a stripped object would put back exactly what that middleware exists to remove, and `/staff` would stop being the canonical first page.

The router adapter also does one thing the codec cannot: a **list-named value of the wrong shape falls through to the router's own serializer instead of being dropped**. Nothing should ever reach it malformed — the router serializes what `validateSearch` validated — and "should never" is how an operator's filter goes missing with nothing said. Writing it the old way is visible and recoverable; omitting it is neither.

**A D4-era URL carrying the JSON encoding is not read back, and that is the decision rather than an oversight.** A compatibility reader for a shape nothing will ever write again is permanent weight on the one function this ADR exists to keep honest; the only URLs of that form in existence are in a developer's own history.

**Amended 2026-08-21 (D5.2): "does not parse" was the wrong description, and what actually happens is worth pinning.** Walked in a browser: `?sort=%5B%7B%22field%22%3A%22email%22...` does not fail at the router. `parseListSearch` reads the whole JSON blob as one **sort token**, `listQuerySearchSchema` accepts it — a token is a string and the direction defaults — and the nonsense field reaches the API, which refuses it with a `VALIDATION_ERROR`. The grid then renders that refusal in its own error panel, which is ADR-0043's read-surface rule working exactly as written.

The outcome is still "a stale bookmark is refused, and nothing carries the old shape", so the decision stands. Two things about it are recorded rather than left as a surprise: the refusal is **the server's, not the client's**, so it costs a round trip; and the message an operator sees is the generic `VALIDATION_ERROR` sentence, which is written for a form and reads oddly under a grid. That second one is a **pre-existing gap in `ERROR_MESSAGES`** rather than anything this decision introduced — a list query and a form submission share one code — and it is left for the deliverable that owns operator copy (D7) rather than fixed in passing here.

**And the test goes at the seam.** `D4.7` is the standing evidence for why: `q` could not be cleared for an entire deliverable because the pure functions were right and every suite asserted _setting_ a term rather than clearing one, so the defect lived entirely between two correct pieces. A codec round-trip is necessary and not sufficient here; the requirement is a **real router** — apply a filter, read `window.location.search`, mount a fresh router at that URL, assert the same grid.

### QueryClient defaults — decided, not defaulted

The library's defaults assume a generic app; this one is an admin panel over a low-collaboration dataset, and the defaults are chosen for it, in one `create*` wrapper ([ADR-0009](0009-api-modular-layering.md) — third-party constructors are wrapped):

```ts
// app/query-client.ts
export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) =>
          isApiClientError(error) && error.status >= 400 && error.status < 500
            ? false
            : failureCount < 2,
      },
      mutations: { retry: false },
    },
    mutationCache: createNotifyingMutationCache(), // §Notifications
    queryCache: createNotifyingQueryCache(),
  });
```

- **`staleTime` ~30 seconds.** The default of `0` marks everything stale immediately, so every window focus and every remount refetches — a refetch storm that buys nothing when the data is admin CRUD that mostly changes because _this_ user changed it (and mutations invalidate explicitly, below). Thirty seconds of acceptable staleness is the same judgement ADR-0014 made server-side when it let `total` come from a second, non-transactional query: "an admin table showing a count one insert stale is not a correctness problem."
- **Never retry an answer; do retry a failure.** The predicate discriminates on **`status`**, not on `isApiClientError` alone, and the difference is not cosmetic — ADR-0033's `D3.4` amendment pinned `TRANSPORT_ERROR_CODE`, which made _every_ rejection out of the client an `ApiClientError`, a dead socket included. `isApiClientError(error) ? false : failureCount < 2` therefore retries **nothing**: its second clause is unreachable except for bugs (a `TypeError` in a mapper), which it then retries twice. The rule as intended, and as written above: a `4xx` carrying a contracts code is an _answer_ — the server parsed the request and refused it — and retrying a `403` three times triples load and delays the real feedback; transport failures (`status: 0`) and `5xx` get up to two retries. This is ADR-0034's `D3.5` correction, folded in.
- **Mutations never retry.** A write whose response was lost may have been applied; replaying it automatically risks doing the thing twice. The user retries deliberately, from the error toast.

### Entity API functions and hooks

Each entity slice owns its API surface: plain typed functions over ADR-0033's client, returning `@repo/contracts` resource types — no fetch logic in components, no ad hoc response shapes. The files are flat — `entities/staff/staff.keys.ts`, `staff.api.ts`, `staff.queries.ts` — which matches the `<module>.<layer>.ts` naming ADR-0009 established on the API side and keeps one convention across the repository.

```ts
// entities/staff/staff.api.ts — a factory over the client, not module-level functions
export const createStaffApi = (client: ApiClient) =>
  ({
    list: (params: ListStaffQuery): Promise<Page<StaffResource>> => …,
    get: (id: string): Promise<StaffResource> => …,
    create: (body: CreateStaffBody): Promise<StaffResource> => …,
  }) as const;

// entities/staff/staff.queries.ts — hooks wrapping it
export const useStaff = (id: string) => { … useQuery({ queryKey: staffKeys.detail(id), queryFn: … }) };
```

A factory rather than free functions, per ADR-0009's rule that third-party constructors are wrapped — and the consequence, found at `D4.2` and folded in from ADR-0040: **a route loader is not a component and has no hooks**, so the router context carries the client (`{ session, queryClient, client }`) and a loader writes `createStaffApi(context.client)`. The split between plain functions and hooks is what makes both possible: the functions are testable without a React tree ([ADR-0036](0036-admin-testing-strategy.md)), and a loader can call `queryClient.ensureQueryData` with the same key + function pair the hook uses.

The message map lives in `shared/notifications/messages.ts` and the `meta` type augmentation in `shared/api/query-meta.ts`, both in `shared` rather than beside the query client: `entities` and `features` write `meta` and may need `messageForError` for a form-level message, and ADR-0032 forbids either importing from `app`.

### Invalidation — the boring convention

**A mutation invalidates its own entity's `lists()` prefix and the touched `detail(id)`.**

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

Three refinements, each of which D3 discovered by hitting it:

- **The word doing the work is _its_.** `POST /admin/staff/:id/sessions/revoke` writes only `sessions`, an aggregate this app does not cache and has no key factory for; the `staff` row is untouched, so there is no key of that entity's to invalidate, and an `invalidateQueries` there would be a refetch that can only ever return what is already on screen. The test to apply — and the one that keeps this from becoming a licence to skip invalidation — is: **does the response of any cached query change because of this write?** For the sibling case it plainly does: `POST /:id/password` sets `updatedAt` on the row ([ADR-0027](0027-credential-self-service-and-reset.md)), so the administrative reset invalidates `lists()` and `detail(id)` exactly like an update despite carrying no resource field in its body.
- **When a write changes _another_ entity's row, the invalidation belongs to the feature.** `PATCH /admin/profile` is the first write the rule does not cover: the acting operator is also a row in `/admin/staff`, so a rename leaves that row's names stale. The entity cannot fix it, and the reason is ADR-0032 rather than taste — an entity may import from `shared` and nowhere else, so `entities/profile` cannot see `staffKeys`. A **feature** may import any entity slice and already owns the interaction, so `features/profile-manage/use-invalidate-own-staff-row.ts` invalidates the staff prefix after both writes. The general form: **the mutation invalidates its own entity; the feature invalidates whatever else its interaction touched.** A cross-entity invalidation _vocabulary_ — entities declaring what they are downstream of — stays unbuilt, and the second case of this is what should justify it.
- **A mutation whose _variables_ are a credential sets `gcTime: 0`.** TanStack Query keeps a settled mutation, including the variables it was called with, in the mutation cache for `gcTime` — five minutes by default — so a password submitted through `mutateAsync` outlives the dialog that collected it, the `reset()` that cleared it and the unmount that removed it. Nothing reads it; the point is that nothing _can_. One definition, `CREDENTIAL_MUTATION` in `shared/api/credential-mutation.ts`, because by the third credential mutation it had been written three times (ADR-0032 stops one entity importing another's copy) and deleting any copy is a silent change that leaves the suite green while two plaintexts sit in `getMutationCache()`. `renderWithProviders` returns the query client so a test can assert the cache is empty once the dialog has settled: **a security property no test can observe is a comment.**

**Optimistic updates are deliberately not the default.** This is a server-authoritative CRUD panel on a low-latency API: the rollback bookkeeping (`onMutate` snapshot, cancel in-flight queries, restore on error) buys a few hundred milliseconds of perceived speed and costs a class of bugs where the screen briefly showed a state the server rejected. A default with an escape hatch, not a ban — a feature where UX demands immediacy may opt in, and when it does, the full pattern, not a partial one.

### Notifications — sonner, attached declaratively via `meta`

The toast component is **sonner**, shipped from `@repo/ui` ([ADR-0031](0031-ui-design-system.md)); `<Toaster />` is mounted **once**, in the app layer, next to the providers. The attach point for mutation outcomes is **declarative**: the global `MutationCache` / `QueryCache` callbacks read each operation's `meta`, so a mutation states its outcome and never calls `toast()` itself.

```ts
// A mutation declares its outcome…
useMutation({
  mutationFn: createStaff,
  meta: { success: "Staff member created." },
});

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

- **Error toasting is automatic and needs no declaration.** The handler maps `ApiClientError.code` (ADR-0033) through **one message map keyed by the `@repo/contracts` `ErrorCode` union**. Typing it `Record<ErrorCode, string>` makes the compiler enforce what ADR-0013 designed for: a new code added to contracts fails the admin build until someone writes its message. At runtime an unrecognised code (an older bundle against a newer API) falls back to a generic message, which is exactly what contracts tells clients to do.
- **There are exactly two catalogues of operator-facing copy, and they are catalogues of different things.** Error **codes** are catalogued in `ERROR_MESSAGES`; **field rules** are catalogued in the contracts schema that defines them. `applyServerErrors` rendering a validation detail's own `message` is not a second source: a detail carrying a `path` is a zod issue from a `@repo/contracts` schema, and that schema is the _same_ object the form validated with on the way in ([ADR-0011](0011-middleware-pipeline.md)/ADR-0023) — so the sentence shown is the one the client would have shown had it caught the rule first, and mapping it here would make one rule read two ways depending on which side noticed it. Localising the second kind is a zod error map on the contracts package, applied once for both sides. Two checks keep it honest rather than one convention: a detail's own words are rendered only when the code is `VALIDATION_ERROR` (because "only zod sets a `path`" is true of the API today and enforced by nothing — `AppError` takes arbitrary `details`), and only when the field is one this form renders. Everything else falls through to the map. The residual, recorded rather than glossed: a form whose _state is not its body_ can be told about a key its controls never held, and zod's own type message for it is a sentence the client-side resolver would never have produced. It still lands somewhere visible; it is just not a sentence the operator has seen before.
- **The API's own `error.message` is never rendered.** It is the developer-facing English default ADR-0013 describes, and the two catalogues above are what operators read.
- **Queries are silent unless they ask** (`meta: { errorToast: true }`), the mirror of the mutation rule. The justification for automatic mutation toasts — "the failure always matters" — is untrue of a read: a failed list has an error panel in the place the data would have been, and a background refetch failing must not interrupt an operator mid-sentence. `queryMeta.errorToast` is typed `?: true` rather than `?: boolean`, because an opt-_out_ on a channel that is already silent would be a no-op that reads like a decision.
- **A surface that reads may not opt into silence unless it renders its own failure.** This is a requirement on the surface, not a hope about it, and `D3.7` found the first grid shipping without it: `AppGrid` rendered its loading skeleton whenever it had no page, the retry policy above short-circuits a `4xx`, and so a `403` from the admin segment's `authorize` mount — the one refusal [ADR-0019](0019-authorization-guards.md) says the client must not pre-guess — arrived as five placeholder rows that never resolved and no message anywhere. `AppGrid` takes the query's `error` and renders it, with a retry, in the table body. The stale-page case stays silent deliberately: `keepPreviousData` means a failed _refetch_ still has a real page on screen, and replacing an operator's view with an apology is the interruption this rule refuses.
- **`meta: { errorToast: false }` opts out** where a form renders the error inline. The division of labour with [ADR-0035](0035-config-driven-resource-ui.md)'s forms: **field-level errors belong to the form**, **operation-level outcomes belong to toasts**. A form that shows "email already in use" under the field suppresses the toast; a delete triggered from a row menu, with no form to speak through, relies on it.
- **`meta` is typed, not stringly-typed**, via TanStack Query's `Register` interface (module augmentation), so `meta: { succes: "…" }` is a compile error and the convention is discoverable from the type:

```ts
declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: { readonly success?: string; readonly errorToast?: boolean };
    queryMeta: { readonly errorToast?: true };
  }
}
```

**No per-callsite `toast()` sprinkling for CRUD outcomes** — that is the anti-pattern this section replaces. Direct `toast()` remains available for genuinely local, non-mutation notices (a "copied to clipboard", a client-side warning); those are not operations and have no `meta` to speak through.

### What this does not decide

- **What a record route's URL contains** — [ADR-0044](0044-record-routes-without-list-state.md), the other half of D5. This ADR decides how list state is spelled when it is in the URL; that one decides when it is there at all.
- **The grid and form components themselves** — ADR-0035, which consumes the list hooks and the inline-error division defined here, and ADR-0039, which renders the applied-filters bar from the search params this ADR spells.
- **The API client, `ApiClientError`, and token refresh** — ADR-0033. This ADR assumes a client whose failures carry a contracts `ErrorCode`.
- **The list-query language itself** — ADR-0014, frozen and untouched. This decision adopts its syntax for a second transport; it does not add an operator, a parameter or a coercion to it.
- **Websocket / server-push invalidation.** Nothing pushes; staleness is bounded by `staleTime` and mutation invalidation.

## Consequences

- **The browser's query string is an API query string.** Copying it onto `/api/v1/admin/staff` in Postman answers "is the client or the server wrong?" in one step, and it makes the acceptance checklist of D5 executable rather than aesthetic. This is the property that justifies the whole change; everything else here is preservation.
- **One serialization has one owner and one test.** The codec is a single pair of functions in contracts with a round-trip property over a table of states, and both consumers — the axios `paramsSerializer` and the router — go through it. The class of bug where two encodings drift is gone rather than caught.
- **The URL is longer for `in` filters and shorter for everything else**, and legible in both cases. A multi-value filter reads `filter[status][in]=active,invited`, which inherits ADR-0014's known limitation that a value containing a comma cannot be expressed in an `in` list. That limit is now visible in the address bar rather than hidden behind JSON, which is an improvement in honesty and a regression in capability — recorded because the first person to filter on a value with a comma will find it here.
- **D4-era URLs break.** Stated plainly rather than mitigated: any bookmark or pasted link carrying `filters=[…]` fails validation after this lands. The blast radius is a developer's own history, and the alternative is a compatibility branch in the codec that outlives everyone who remembers why it is there.
- **Contracts grows a non-schema module.** `list-search.ts` is the first thing in that package that is neither a zod schema nor a type — it is a codec for the language the schemas describe. It stays inside ADR-0023's dependency rule (zod only) and inside its purpose (the shared vocabulary), but the boundary is now "the language, including how it is spelled" rather than "the schemas", and the next thing that wants in will cite this.
- **The router gains a global concern.** `parseSearch`/`stringifySearch` apply to every route, so a bug there is a bug everywhere, and the mitigation is the delegation rule: the codec touches only the names `LIST_QUERY_PARAMS` defines and hands the rest to the default implementation.
- **Everything downstream of the search object is untouched**, which is the claim `D5.2` exists to demonstrate: same validated object, same query keys, same cache entries, same pure functions, same stripped defaults.
- **Staleness is still a stated number.** For up to ~30 seconds, a change made by _another_ admin is invisible until focus or refetch. Accepted for the same reason ADR-0014 accepted a stale `total`; a screen that cannot tolerate it sets its own `staleTime`.
- **Follow-up:** when i18n arrives (D7), the message map becomes the extraction point, and success strings in `meta` need the same treatment — a key rather than English text. That is an amendment to this ADR if D5 is still open, and a superseding one if not.

## Alternatives considered

- **Keep two serializations** — ADR-0034's decision, which is the status quo and costs nothing today. Rejected because D4 made the URL a public artifact of three separate decisions, and because the second serialization is the one nothing can test.
- **A compact custom syntax invented for the browser** (`?f=status:eq:active`). Shorter than brackets and marginally prettier. Rejected on the same ground that motivates the whole ADR: it is a _third_ spelling of a language that already has one, and it would need its own parser, its own escaping rules and its own tests, none of which the API would ever exercise.
- **Move the wire shape into the route's search type** — `validateSearch` over `{ sort?: string, filter?: Record<…> }` — so the router's default serializer produces the right string without a codec. Rejected because it puts strings in front of every consumer of `useSearch`, turns each of them into a parser, and reintroduces the `D3.5` involution failure from the other side. It also makes ADR-0039's applied-filters bar re-parse the URL to render a chip.
- **A per-route `search` middleware instead of the router codec.** Middleware runs on the search _object_, before serialization, so it cannot change how the object is spelled. It is the wrong layer for this, and it is the right layer for `stripSearchParams`, which stays.
- **Percent-encoded brackets** (`filter%5Bstatus%5D=active`), the encoder's default. Correct, portable, and unreadable — which loses the entire benefit while paying the entire cost.
- **A back-compatible reader for the JSON form.** Cheap to write, and permanent. Rejected in §Decision with its reasoning.
- **RTK Query or SWR** instead of TanStack Query. Fine tools solving the same problem. RTK Query drags in a Redux store this app otherwise has no need for; SWR is lighter but weaker on mutations and structural key invalidation. TanStack Query pairs with TanStack Router's loader/`context` integration (ADR-0032), which is where `ensureQueryData` on navigation comes from.
- **Redux (or any store) as the server cache.** The classic shape: fetch in a thunk, normalise into slices, select back out. It re-implements staleness, deduplication and invalidation by hand — the exact machinery TanStack Query ships — and history says it is re-implemented worse.
- **Per-mutation `onSuccess`/`onError` callbacks for toasts, everywhere.** Works, and every call site restates the policy: which errors toast, what wording, whether the form already showed it. The `meta` pattern keeps the _declaration_ local and the _policy_ global, which is the difference between convention and habit.
- **A global error boundary only.** Boundaries catch render-time failures and show a fallback screen; they cannot say "that particular delete failed because the account is the last super admin" while the rest of the page stands. Per-operation messaging needs the operation, which is what the mutation cache has and a boundary does not. Boundaries remain in play for render errors — a different failure class, out of this ADR's scope.
