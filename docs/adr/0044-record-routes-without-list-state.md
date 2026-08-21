# ADR-0044: Record routes and edit surfaces — a record URL carries only the record

- Status: accepted
- Date: 2026-08-21
- Supersedes: [ADR-0040](0040-record-routes-and-edit-surfaces.md)

> One of the D5 (grid URL readability) decision set, written with [ADR-0043](0043-readable-list-search-params.md) on the day D5 opened. `D5.3` is the implementing step (`docs/plan/0005-grid-url-readability.md`). **Accepted 2026-08-21**, at the head of that step (ADR-0025 rule 3). It stays amendable in place while D5 is `in progress` in `docs/plan/README.md` (ADR-0025 rule 2).
>
> **This record carries the whole of ADR-0040, not the delta** (ADR-0024 rule 1). Everything that ADR decided about which surfaces are addressable, how the routes are shaped, how they load and how the three shells work is restated here unchanged, with its three amendments folded in. **One bullet changes**: how list state survives opening and closing a record.

## Context

D3 shipped two doctrines about state and one omission between them, and ADR-0040 closed the omission: every grid's offset, sort and filters live in the URL, and after `D4.2` so does the identity of the record being edited. Create and edit became routes; `/staff/3f2a…` is a link, a refresh re-renders the surface, and Back closes it. That decision stands in full.

**What changed is the price it paid for one requirement.** ADR-0040 required that list search params survive opening and closing a record — the operator opens row three of page two, closes it, and is on page two — and answered it with TanStack Router's `retainSearchParams` middleware on the list parent. The mechanism carries the list state by putting it **in the record's URL**:

```
/staff/3f2a…?offset=40&limit=50&sort=-email&filter[status]=active
```

So the most linkable thing the panel produces — "look at this account" — is a link to an account with the sender's grid stapled to it. Three things make that worth a decision rather than a shrug:

**A record URL is shared outward; a list URL is not.** They look like the same kind of artifact and are not. A grid link is a *view*, and reproducing the sender's view is exactly the point ([ADR-0043](0043-readable-list-search-params.md) keeps that intact and makes it legible). A record link identifies a *thing*, and the recipient's business is the thing. Everything after the `?` is noise they cannot act on, about rows they may not be able to see.

**The params are not merely decorative on the way in.** A recipient opening that link lands with a filter applied to the grid behind the surface — a grid narrower than they asked for, because of a filter someone else set, arriving with no explanation. ADR-0039 built the applied-filters bar precisely so that a narrowed grid is never silent; this is the one path that narrows a grid on somebody else's behalf.

**`retainSearchParams` has already cost this repository once.** `D4.7` found that `q` could not be cleared at all: `retainSearchParams(true)` builds its result as `{ ...search, ...next }`, so a param dropped by *omitting its key* comes straight back, and `q` is the only list param removed that way. It was fixed by naming the four params that survive omission. The fix is correct and the shape of the bug is instructive — a middleware that silently re-adds state is a middleware whose failures are invisible — and D5 removes the middleware rather than keeping a list of names in sync with a schema forever.

The requirement itself is not in question. Closing a record must return the operator to the page they were on; that is not negotiable and it is what the rest of this ADR has to keep true without the URL's help.

## Decision

### Form surfaces become routes; confirmations stay ephemeral

The principled line, drawn once so the next resource does not re-litigate it:

- **A surface whose content is a record being composed or edited is addressable state.** It gets a URL, it survives reload, Back closes it, and a colleague can be sent to it. `create` and `edit` belong to the router.
- **A surface whose content is consent to a destructive act must not be deep-linkable.** A URL that reopens "confirm delete" on load is a footgun — a bookmarked or history-restored destruction prompt, primed and focused, over a row the operator has not looked at. `delete`, `revoke-sessions` and any bulk-destructive confirm ([ADR-0038](0038-grid-selection-and-capabilities.md)'s selection surfaces) stay component state.
- **Reset-password stays ephemeral too.** It is a credential ceremony, not record composition — its variables are secrets that ADR-0043's `CREDENTIAL_MUTATION` (`gcTime: 0`) already treats specially, and nothing about it wants to be shareable or restorable.

The Action-union machinery therefore survives for the ephemeral members and shrinks rather than disappears:

```ts
// features/staff-manage/types.ts
export type StaffAction =
  | { readonly kind: "reset-password"; readonly staff: StaffResource }
  | { readonly kind: "revoke-sessions"; readonly staff: StaffResource }
  | { readonly kind: "delete"; readonly staff: StaffResource };
```

`UserAction` mirrors it. The "one union, one open thing" invariant holds for what remains; for the routed members the router itself is the invariant — one URL matches one child.

### The routes

Each resource's list route is a parent rendering `<Outlet />`, with an index and two children:

```
apps/admin/src/app/routes/
├── _dashboard.staff.tsx            # parent: validateSearch (list state), grid + <Outlet/>
├── _dashboard.staff.index.tsx      # /staff — a null component; the grid stays on the parent
├── _dashboard.staff.new.tsx        # /staff/new — the create form
├── _dashboard.staff.$staffId.tsx   # /staff/:staffId — the edit form
└── … the users trio mirrors it (/users/new, /users/:userId)
```

- **Detail routes load through the loader, with the entity's own key and function**, which is what the router context has carried since `D3.5`:

  ```ts
  export const Route = createFileRoute("/_dashboard/staff/$staffId")({
    loader: ({ context, params }) => {
      const api = createStaffApi(context.client);
      return context.queryClient.ensureQueryData({
        queryKey: staffKeys.detail(params.staffId),
        queryFn: () => api.get(params.staffId),
      });
    },
    staticData: { title: "Edit staff member" },
    component: StaffEditSurface,
  });
  ```

  **The context carries the API client**, not just `{ session, queryClient }`: an entity's API is a `create<Entity>Api(client)` factory reached from components through `useApiClient()`, a loader is not a component and has no hooks, so there is no expression a loader could otherwise write. This is [ADR-0032](0032-admin-app-architecture.md) holding rather than bending — its decision is a context carrying "what guards and loaders need" — and it keeps [ADR-0036](0036-admin-testing-strategy.md)'s posture exactly, since `renderApp` passes the client it built for the test and nothing reaches for a module-scope singleton.

  `new` has no id and skips the detail query entirely; its form initialises from the config's `initialValue`s ([ADR-0035](0035-config-driven-resource-ui.md)).

- **A record URL carries only the record.** No search middleware on the list parent, no list params on `/staff/$staffId` or `/staff/new`. `validateSearch: listQuerySearchSchema` stays on the parent, so the list state is validated once and visible to the index and the children alike — it is simply absent from the URL while a record is open.

- **The list state travels in history state, not in the query string.** The entry point that opens a record carries it; the close navigation puts it back:

  ```ts
  // shared/grid — one helper, both halves, and it never learns a resource name
  navigate({ to: recordPath, params, state: { list: listState } });   // open
  navigate({ to: listPath, search: location.state.list ?? {} });       // close
  ```

  Three properties make this the right carrier rather than a trick. It **survives a reload**, because `history.state` is preserved per entry by the browser — a refresh with a drawer open re-renders the record *and* the grid behind it. It **survives Back and Forward**, because each history entry keeps its own state and the list entry keeps its own URL. And it is **absent for a cold link**, which is the entire point: a record URL that arrives from somebody else has no state, renders the bare list behind it, and closes to the bare list.

  **The grid behind an overlay is why this needs a carrier at all**, and it is the trap in this decision. For `dialog` and `drawer` the parent renders the grid *and* the `Outlet`, so the grid behind the surface reads **the parent route's search — which is the record route's URL**. Removing the params with nothing in their place would leave a drawer floating over page one of an unfiltered grid, and closing it would land the operator there. Anyone re-deriving this decision from "just drop the params" will ship that.

  **`q` clearing must stay fixed, and the reason it stays fixed changes.** `D4.7`'s defect was `retainSearchParams(true)` re-adding a param that `withSearch(state, "")` removes by omitting its key; the middleware is gone, so the mechanism that re-added it is gone. `RETAINED_SEARCH_PARAMS` goes with it. The two regression tests `D4.7` wrote do not go with it — they assert an operator-visible property (empty the search box, the term is no longer applied) and they now guard a different implementation of the same requirement, which is what makes them worth keeping rather than deleting alongside their cause.

  **Amended 2026-08-21 (D5.3): the snapshot is validated on the way in, and `location.search` is not `useSearch`.** The code sketch above reads the list state from the location, and the first implementation of it shipped a crash: `useRouterState({ select: (s) => s.location.search })` yields **what the URL literally carried**, while `useSearch({ from })` yields the route's *validated* object. On a bare `/staff` those differ — the former is `{}` — so the carrier handed the grid a state with no `sort` and no `filters`, and the grid died on its first `.map`. The carrier therefore normalises through `listQuerySearchSchema` (with `safeParse`, because it runs on every route and a screen with no list state must not throw its way out of a render). A shared helper cannot name a route, so it cannot use `useSearch`; asking the schema is how it gets a whole state anyway.

  The carrier is also **memoised on the location's own values**, which is a correctness requirement rather than a performance one: a row-action list is itself a `useMemo`, so a carrier rebuilt every render would either be left out of its dependencies — capturing the list state as it was when the actions were built, and carrying *that* into a record opened three pages later — or be included and rebuild the actions constantly.

- **Closing an edit surface is a navigation.** Cancel, Escape, the overlay click and the post-save close all resolve to the close call above. There is no `onClose` callback to thread; the router is the close handler.

- **An invalid or unknown id renders the error surface and offers the way back to the list** — the loader's rejection (a `404`, an id that is not a UUID) reaches the route's `errorComponent`, never a blank overlay over a live grid. This is the routed sibling of ADR-0043's rule that a surface which reads must render its own failure.

### Three edit surfaces, one per-resource config choice

`ResourceConfig.grid` — ADR-0038's capability block — carries one more key:

```ts
export const staffResourceConfig = {
  name: "staff",
  grid: {
    // …ADR-0038's capability block…
    editSurface: "dialog", // "dialog" | "drawer" | "page"; default "dialog"
  },
  columns: { … },
  fields: { … },
} as const satisfies ResourceConfig;
```

A string key, because ADR-0035's rule stands: configs are data, and "which shell" is exactly the kind of finite, serializable vocabulary that rule exists for. The default is `"dialog"`.

**All three surfaces render the same config-driven form** (ADR-0035: contracts `zodResolver`, `AppFormProvider`, the field registry, `applyServerErrors`, every field disabled while the mutation is pending). Only the shell differs:

- **`dialog`** — `AppFormDialog`.
- **`drawer`** — the same frame in a shadcn `Sheet` (`side="right"`, [ADR-0031](0031-ui-design-system.md)), partially overlaying a grid that stays on screen.
- **`page`** — a full-width standalone surface; the grid is not on screen.

**Route topology follows the surface, in one place.** For `dialog` and `drawer` the parent renders the grid *and* the Outlet, so the overlay sits above a live grid; for `page` the parent renders only the Outlet while a child matches, and the grid unmounts. The child component picks its shell from the config. **The URL is identical across all three**, so switching a resource is a one-line config change that breaks no link, no bookmark and no test that navigates by path — and with this ADR that URL is also the same for a resource with a page shell, which has no grid behind it to preserve and uses the same close call regardless.

**All three shells are covered by one suite, by accessible name** — the form, the Cancel path, the submit lock, a real submit — because `D4.2` shipped `page` implemented, specified and unexercised, and found two defects in it the moment a resource declared it. A shell with coverage but no config path into it is where the next defect lives.

### Details pinned

- The grid underneath a dialog or drawer is interactive in principle, but the overlay owns focus — the Radix `Dialog`/`Sheet` defaults, not custom work.
- **An in-flight mutation blocks dismissal in all three shells.** "A form that locks its fields and then lets the operator close the window has not locked anything" — carried to the Sheet's `onOpenChange` and to the page shell alike. The page shell has no dismissal gesture *of its own*, and it sits inside `_dashboard`, where every sidebar link and the Back button are ways out; leaving mid-submit lands the mutation with no form left to render its failure in. `useBlocker` on the page shell, `enableBeforeUnload: false`, because this guards an in-app navigation and not the tab — which is also why that shell is its own component: a blocker is a hook, and the surface switch returns early for the other two.
- **After save, navigate to the list and let ADR-0043's invalidation refresh it.** No imperative refetch, no optimistic row-patching; the mutation invalidates `lists()` and `detail(id)` and the grid the operator returns to is already reloading.
- **Direct load of `/users/$id` in a fresh session works because the loader fetches** — the `_dashboard` guard runs first (ADR-0032), then `ensureQueryData` pulls the record; behind a drawer, the grid shows its normal loading state in parallel. Nothing about the routed surfaces assumes the list was visited first, and after this ADR nothing about them assumes the URL describes the list either.
- **The list route needs an index leaf, and the grid does not live on it.** A parent with children needs a child to match at its own path, so `/staff/` exists with a `null` component — but the grid stays on the *parent*. Putting the list on the index route is the obvious arrangement and is wrong: opening a dialog would unmount the grid and rebuild it on close, losing scroll position and re-running the query, which is precisely what an overlay over a live grid must not do. The corollary is that "a record surface is open" cannot be answered by counting child matches, since the index is a child too. `useMatchRoute` against the two record paths answers it, and is typed, so a renamed route is a compile error rather than a grid that quietly stopped disappearing. Two things that call must say explicitly, both found in a browser: **`includeSearch: false`**, since `matchRoute` compares search params by default — this mattered acutely while the record URL carried retained search, and it stays because the *list* still has search and the question is about the path; and **`||` rather than `??`**, since a miss is `false` and not `undefined`, so the nullish operator would return the first miss and never ask about the second path.

## Consequences

- **"Look at this account" is a link to an account.** `/staff/3f2a…` and nothing else: nothing about the sender's page, size, sort or filters, and nothing for the recipient to be silently narrowed by.
- **Closing still returns the operator to their page, including after a reload**, which is the requirement ADR-0040 had and this keeps. What changes is where the state rides.
- **A cold record link closes to the bare list.** The honest answer rather than a degradation — the recipient never had the sender's view, and the previous behaviour only appeared to give it to them because it was stapled to the link. Worth naming because it is the one behaviour a reader might file as a bug: opening a colleague's link and closing it lands on `/staff`, not on the colleague's page 2.
- **State that is not in the URL is state a test can forget to check.** The mitigation is that the *observable* requirement — close lands on filtered page 3, reload keeps the grid behind the drawer — is exactly what `D5.3` asserts, at the router, rather than asserting that a particular key is present in a particular place. `D4.7`'s lesson is that the seam is where these fail.
- **`retainSearchParams` and `RETAINED_SEARCH_PARAMS` are gone**, and with them a list of param names that had to stay in step with a zod schema and whose drift nothing could see. A sixth list param added to `listQuerySearchSchema` needs no second registration anywhere.
- **History state is the second non-URL carrier in this app**, after ADR-0041's preference storage, and the rule dividing them is now three-way: **the URL owns view state, preferences own ergonomics, and history state owns the way back.** Anything durable, shareable or reproducible belongs in the first; nothing about a credential or a selection belongs in any of them.
- **Back and forward still close and reopen edit surfaces**, unchanged: navigation is the state change.
- **Edit is still shareable, bookmarkable and reload-restorable** — more shareable, in fact, since the link is now portable. Uncommitted *keystrokes* still die on reload; the URL addresses the record, not the draft, and persisting drafts would be a new decision.
- **Route files stay at four per resource**, and the `new-resource-ui` checklist gains the open/close helper rather than a middleware line.

## Alternatives considered

- **Keep `retainSearchParams`** — ADR-0040's decision. Simple, purpose-built, and it puts a stranger's grid in a link. Rejected in §Context, and its `D4.7` failure is the secondary reason rather than the primary one.
- **Drop the params and accept the reset.** The one-line version: remove the middleware, let the grid behind the drawer render defaults, let close land on page one. Rejected because closing an overlay and finding yourself somewhere else is a worse defect than the one being fixed — the operator did not navigate, and the app moved them.
- **A module-scoped "last list state per grid" in `shared/grid`.** Simpler than history state and wrong in two directions at once: it does not survive a reload, and it *does* survive a navigation it should not, so a cold link opened in a tab that had previously browsed a filtered list would restore that filter behind the record. History state is per entry, which is exactly the granularity the requirement has.
- **An `?edit=<id>` search param instead of a path segment.** Keeps flat route files. Rejected because a record's identity is path material — [ADR-0015](0015-route-segments-and-versioning.md) puts the id in the path on the API and REST instinct agrees — while search is reserved for list state. It would also hash edit state into list cache keys.
- **Making confirmations routes too.** Uniform, and rejected for the reason §Decision leads with: a deep-linkable destruction prompt is a footgun, and uniformity is not worth shipping one.
- **A `surface` prop on `AppGrid` rather than on `ResourceConfig`.** Puts the choice at the call site, where it can differ per usage and drift per copy. The surface is a property of the resource's UX, and config is where per-resource UI vocabulary lives (ADR-0035).
- **React state plus `history.pushState` by hand.** Keeps the union and fakes the URL. It is rebuilding the router — no typed params, no loader, no guard inheritance — inside an app that already pays for a real one.
