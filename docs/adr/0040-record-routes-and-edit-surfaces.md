# ADR-0040: Record routes and edit surfaces — dialog, drawer, page

- Status: accepted
- Date: 2026-08-20

> One of the D4 (data grid v2) decision set, written together with ADR-0037–0039 and ADR-0041 while D3's screens are the freshest evidence available. `D4.2` is the planned implementing step (`docs/plan/0004-data-grid-v2.md`). It stays amendable in place while D4 is `in progress` in `docs/plan/README.md` (ADR-0025 rule 2). **Accepted 2026-08-20**, at the head of `D4.2` — the per-step acceptance D4 runs on.

## Context

D3 shipped two doctrines about state and one omission between them. [ADR-0034](0034-server-state-and-notifications.md) put every grid's offset, sort and filters in the URL — "back/forward walks table states because navigation *is* the state change" — and [ADR-0032](0032-admin-app-architecture.md) supplied the typed search params that make it hold. Both stop at the list. The record being *edited* got the opposite treatment: every staff and users interaction — create, edit, reset-password, revoke-sessions, delete — opens from one page-local `useState<StaffAction | null>` over a five-member discriminated union (`features/staff-manage/types.ts`), and `<StaffDialogs action onClose>` mounts exactly one dialog. The machinery is good — one union means "two dialogs open at once" is unrepresentable, and mounting only the active dialog gives each `useForm` a fresh start per opening — but the consequence is confirmed by inspection: **an open edit dialog is invisible to the URL.** It is not deep-linkable ("look at this staff member" cannot be a link), not reload-restorable (a refresh mid-edit lands on the bare list), and Back does not close it — the one navigation gesture ADR-0034 taught operators to trust does nothing to the most prominent surface on screen.

Two further forces:

**The dialog is the only surface, and it will not stay sufficient.** A modal fits five fields; a resource with twenty, or one whose edit wants the grid visible for context, wants a side drawer; a genuinely large record wants the whole page. D4's requirement is all three, chosen per resource — and chosen in the one place a resource's UI vocabulary already lives, its `ResourceConfig` (ADR-0035).

**The plumbing for the fix already exists, unused.** The router context has carried `{ session, queryClient }` since `D3.5` — `app/routes/__root.tsx` says explicitly it is threaded through "because that is what lets a route loader call `ensureQueryData` with the same key and function the hook uses", and no loader uses it yet. The entity key factories already define `detail(id)` (ADR-0034 §Query keys). The routes today are flat files — `_dashboard.staff.tsx` (`/staff`), `_dashboard.users.tsx` (`/users`), both `validateSearch: listQuerySearchSchema` (the *parsed* contracts shape; the D3.5 finding in ADR-0034 records why not the endpoint builders) — with no detail children and no `retainSearchParams` anywhere. Everything this ADR needs is either present and idle or one file-convention away.

## Decision

### Form surfaces become routes; confirmations stay ephemeral

The principled line, drawn once so the next resource does not re-litigate it:

- **A surface whose content is a record being composed or edited is addressable state.** It gets a URL, it survives reload, Back closes it, and a colleague can be sent to it. `create` and `edit` leave the Action union for the router.
- **A surface whose content is consent to a destructive act must not be deep-linkable.** A URL that reopens "confirm delete" on load is a footgun — a bookmarked or history-restored destruction prompt, primed and focused, over a row the operator has not looked at. `delete`, `revoke-sessions` and any future bulk-destructive confirm (ADR-0038's selection surfaces) remain component state, exactly as today.
- **Reset-password stays ephemeral too.** It is a credential ceremony, not record composition — its variables are secrets ADR-0034's `gcTime: 0` amendment already treats specially, and nothing about it wants to be shareable or restorable.

The Action-union machinery therefore survives for the ephemeral members and shrinks rather than disappears:

```ts
// features/staff-manage/types.ts — after D4.2
export type StaffAction =
  | { readonly kind: "reset-password"; readonly staff: StaffResource }
  | { readonly kind: "revoke-sessions"; readonly staff: StaffResource }
  | { readonly kind: "delete"; readonly staff: StaffResource };
```

`UserAction` shrinks the same way. The "one union, one open thing" invariant still holds for what remains; for the routed members the router itself is the invariant — one URL matches one child.

### The routes

Each resource's list route becomes a parent rendering `<Outlet />`, with an index and two children. TSR's file conventions decide exact filenames; the intent, stated so the tree is unambiguous:

```
apps/admin/src/app/routes/
├── _dashboard.staff.tsx            # parent: validateSearch (list state), grid + <Outlet/>
├── _dashboard.staff.index.tsx      # /staff — the grid alone
├── _dashboard.staff.new.tsx        # /staff/new — the create form
├── _dashboard.staff.$staffId.tsx   # /staff/:staffId — the edit form
└── … the users trio mirrors it (/users/new, /users/:userId)
```

- **Detail routes load through the loader, with the entity's own key and function.** This is the first real user of the loader/context plumbing D3 left idle, and it is used exactly the way ADR-0034 §Entity API promised:

  ```ts
  // app/routes/_dashboard.staff.$staffId.tsx
  export const Route = createFileRoute("/_dashboard/staff/$staffId")({
    loader: ({ context, params }) =>
      context.queryClient.ensureQueryData({
        queryKey: staffKeys.detail(params.staffId),
        queryFn: () => getStaff(params.staffId),
      }),
    staticData: { title: "Edit staff member" },
    component: StaffEditSurface,
  });
  ```

  `new` has no id and skips the detail query entirely; its form initialises from the config's `initialValue`s as today (ADR-0035).

- **List search params must survive opening and closing a record.** `/users/3f2a…?offset=20&sort=-createdAt` round-trips: the operator opens row three of page two, closes it, and is on page two. The mechanism is TanStack Router's **`retainSearchParams` search middleware on the list parent** — the purpose-built one, pinned here so `D4.2` does not choose between it and hand-propagating `search` on every `Link` and `navigate`. `validateSearch: listQuerySearchSchema` moves to (stays on) the parent, so the list state is validated once and visible to the index and the children alike.

- **Closing an edit surface is a navigation.** Cancel, Escape, the overlay click and the post-save close all resolve to `navigate({ to: "/staff", search: true })`-shaped calls back to the list route, search intact. There is no `onClose` callback to thread; the router is the close handler.

- **An invalid or unknown id renders the error surface and offers the way back to the list** — the loader's rejection (a `404` from `getStaff`, an id that is not a UUID) reaches the route's `errorComponent`, never a blank overlay over a live grid. This is the routed sibling of the D3.7 rule that a surface which reads must render its own failure (ADR-0034).

### Three edit surfaces, one per-resource config choice

`ResourceConfig.grid` — the block [ADR-0038](0038-grid-selection-and-capabilities.md) introduces — gains one key:

```ts
export const staffResourceConfig = {
  name: "staff",
  grid: {
    // …ADR-0038's capability block…
    editSurface: "dialog",   // "dialog" | "drawer" | "page"; default "dialog"
  },
  columns: { … },
  fields: { … },
} as const satisfies ResourceConfig;
```

It is a string key, because the ADR-0035 rule stands: configs are data, and "which shell" is exactly the kind of finite, serializable vocabulary that rule exists for. The default is `"dialog"` — today's behaviour, so adopting this ADR changes no resource's look until its config says so.

**All three surfaces render the same config-driven form** (ADR-0035: contracts `zodResolver`, `AppFormProvider`, the field registry, `applyServerErrors`, every field disabled while the mutation is pending). Only the shell differs:

- **`dialog`** — `AppFormDialog`, as today.
- **`drawer`** — the same frame in a shadcn `Sheet` (`side="right"`, ADR-0031), partially overlaying a grid that stays on screen.
- **`page`** — a full-width standalone surface; the grid is not on screen.

**Route topology follows the surface, in one place.** For `dialog` and `drawer` the parent list route renders the grid *and* the Outlet, so the overlay sits above a live grid; for `page` the parent renders only the Outlet while a child matches — one conditional on `useChildMatches` plus the config, and the grid unmounts. The child component picks its shell from the config. Crucially, **the URL is identical across all three**: switching a resource from dialog to drawer to page is a one-line config change that breaks no link, no bookmark and no test that navigates by path.

### Details pinned, so `D4.2` does not rediscover them

- The grid underneath a dialog or drawer is interactive in principle, but the overlay owns focus — the Radix `Dialog`/`Sheet` defaults, not custom work.
- **An in-flight mutation blocks dismissal in all three shells.** `AppFormDialog`'s rule ("a form that locks its fields and then lets the operator close the window has not locked anything") carries to the Sheet's `onOpenChange` and to the page shell's navigation affordances alike.
- **After save, navigate to the list and let ADR-0034 invalidation refresh it.** No imperative refetch, no optimistic row-patching; the mutation invalidates `lists()` and `detail(id)` and the grid the operator returns to is already reloading.
- **Direct load of `/users/$id` in a fresh session works because the loader fetches** — the `_dashboard` guard runs first (ADR-0032), then `ensureQueryData` pulls the record; behind a drawer, the grid shows its normal loading state in parallel. Nothing about the routed surfaces assumes the list was visited first.

## Consequences

- **Back and forward now close and reopen edit surfaces.** Navigation-is-state, the ADR-0032/0034 doctrine, is extended from list state to record identity — the two kinds of URL-worthy state the app has are now both in the URL.
- **Edit is shareable, bookmarkable and reload-restorable.** "Look at this account" becomes a link; a refresh mid-edit re-fetches through the loader and re-renders the same surface. (Uncommitted *keystrokes* still die on reload — the URL addresses the record, not the draft, and persisting drafts would be a new decision, not this one.)
- **The page's dialog-state union shrinks but does not disappear.** Destructive confirms and the password ceremony keep it, so every resource page now has two regimes — routed forms and ephemeral confirms — and ADR-0036's tests must cover both: a routed edit asserted through the router (URL in, surface out), a confirm asserted through the union as today.
- **Route files grow per resource** — one file becomes four. The future `new-resource-ui` checklist (ADR-0035 §Consequences) gains a line; the files stay thin by ADR-0032's rule, and `staticData` titles on the new detail routes feed `useRouteTitle` the way every existing route does.
- **The D3-era entry points become navigations.** The "New staff member" button and the row `edit` action stop calling `setAction` and become `Link`/`navigate` calls; ADR-0038's toolbar wires `canCreate` to the `new` route.
- **The loader/context plumbing earns its keep.** `queryClient` in router context and the `detail(id)` factories stop being speculative — and their first consumer fixes the pattern for every loader after it.
- A resource's surface choice is one config line, which also means it is one config line *away from churn* — the mitigation is that the URL contract is surface-independent, so churn costs a re-render, not a migration.

## Alternatives considered

- **Dialog state in a search param (`?edit=<id>`) instead of a path segment.** Works, and keeps the flat route files. Rejected because a record's identity is path material — [ADR-0015](0015-route-segments-and-versioning.md)'s own segmenting puts the id in the path on the API, and REST instinct agrees — while search stays reserved for list state per ADR-0034. Mixing an id into the search muddies both: the list schema would need to tolerate a foreign key, and the "same URL, same query key" property would hash edit state into list cache keys.
- **Making confirmations routes too.** Uniform, and rejected for the reason §Decision leads with: a deep-linkable destruction prompt is a footgun, and uniformity is not worth shipping one.
- **Modal-only, no config.** Cheapest, and not the requirement — three surfaces per resource is the point of the decision, and the drawer/page cases are real (wide records, context-preserving edits).
- **A `surface` prop on `AppGrid` (or on the page) rather than on `ResourceConfig`.** Puts the choice at the call site, where it can differ per usage and drift per copy. The surface is a property of the resource's UX, and config is where per-resource UI vocabulary lives (ADR-0035); a prop would be the per-callsite habit the config exists to replace.
- **React state plus `history.pushState` by hand.** Keeps the union and fakes the URL. It is rebuilding the router — no typed params, no loader, no guard inheritance, no `retainSearchParams` — inside an app that already pays for a real one.
