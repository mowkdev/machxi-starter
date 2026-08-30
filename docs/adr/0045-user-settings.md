# ADR-0045: User settings — one resource on both segments, and the server adapter behind ADR-0041's seam

- Status: superseded by [ADR-0053](0053-account-area.md) (deltas: where the theme control renders; the settings core gains the density key)
- Date: 2026-08-22

> The D6 (user settings) decision set, which is this record alone. `D6.1`–`D6.3` are the implementing steps (`docs/plan/0006-user-settings.md`). Written 2026-08-22, the day D6 opened. **Accepted 2026-08-22**, at the head of `D6.1` — the per-step acceptance D4 established and D5 continued (ADR-0025 rule 3); it stays amendable in place while D6 is `in progress` in `docs/plan/README.md` (rule 2). It is additive beside frozen [ADR-0033](0033-browser-api-client-and-session.md), [ADR-0041](0041-grid-preferences.md) and [ADR-0043](0043-readable-list-search-params.md), and supersedes nothing. **Superseded in part 2026-08-30 by [ADR-0053](0053-account-area.md)**, accepted at the head of `D11.6`: a **delta** supersession per [ADR-0050](0050-adr-lifecycle-and-verification.md) §Lifecycle rule 1, and the deltas are two. The `D6.3` amendment below places the theme control "in the account menu"; 0053 §2 moves it, with the locale switch, to `/account/preferences` and leaves the write path exactly as decided here. And the settings core below — theme, locale, grids — gains a third scalar, `gridDensity`, on both segments (0053 §2 as amended at `D11.6`: an enum column and migration `0005_grid_density.sql`, built the way this record built `theme`). **Everything else this record decides stands and is in force**: the resource on both segments, both tables and the two-table reasoning, the merge rules and the bounds, the server adapter behind ADR-0041's seam, the coalescing writer, the adoption latch, the theme's local cache and pre-paint apply, and the security properties of a subject that is always `ctx.principal`. Read this record for the settings resource and 0053 for where its controls live.

## Context

[ADR-0041](0041-grid-preferences.md) built a store for how an operator likes a grid arranged, put it behind a three-function `PreferenceStorage` adapter, shipped `localStorage` as the first implementation, and made a promise about the second:

> A **server-backed user-settings adapter slots in later without touching the store or AppGrid**: same three functions, same string key, same JSON value. That future user-settings API is a real intention — it is what turns "device-local today" into "account-portable tomorrow", and it belongs on the index's Planned list — but it is _not designed here_; the adapter interface and the versioned value below are the whole contract it inherits.

And its §Consequences named the test: _"when it lands, the store and AppGrid do not change, which is the claim this design should be held to."_ This ADR is that landing, and that sentence is the bar it is measured against — `D6.3` is scheduled as the cheapest possible falsification of a seam that two deliverables (D4.6–D4.7, all of D5) have not touched since it was cut.

Three forces decide the shape, beyond the one ADR-0041 pre-paid.

**The theme is already a setting, held in the wrong place.** `apps/admin/src/app/providers/theme.ts` writes `machxi.admin.theme` to `localStorage` before first paint, standing on the carve-out ADR-0033's D3.1 amendment made for non-credential display state. It is the right mechanism for the first paint — there is no session yet, so there is nothing else to ask — and the wrong _owner_ for the fact: an operator who prefers dark on one machine prefers it on the next, and a device-local key cannot say so. The theme is the smallest possible proof that "display state" and "device state" are not the same category, and a settings resource is where the two come apart.

**D7 needs a locale to persist before it has anything to translate.** The ledger sequences localization after this deliverable on purpose (`docs/plan/0006-user-settings.md` §Why this is first): a locale switch that forgets itself on the next device is a toy, and building its persistence inside D7 would make a settings model a side quest of a copy deliverable. The slot is cheap to reserve now — one enum column with one value — and expensive to retrofit.

**Both populations have the same need today and ADR-0017 gives them separate aggregates.** Staff read the admin panel; customers will read the D8 app; both want a theme, a locale and, eventually, arranged grids. The same-shape-today fact invites the `sessions` answer — one table, a `principal_type` discriminator — and `packages/db/src/schema/sessions.ts` is honest about what that answer costs: it exists because Postgres cannot express a polymorphic foreign key, so the service has to sweep sessions by hand when a principal goes. Sessions had no choice. Settings do, and two facts decide it the other way: a settings row **can** have a real foreign key to its principal if each population has its own table, and the two populations' settings are the kind of thing that diverges — an operator's panel and a customer's app will want different knobs within a deliverable or two — which is precisely the divergence [ADR-0017](0017-identity-model-populations-and-roles.md) refused to host in one `accounts` table.

One constraint runs through everything below and is stated once here: **a settings row is display state and nothing else** — column ids and widths, a theme, a locale. Never row data, never a filter value, never anything typed into a grid. That is ADR-0041's line restated for the server, and it is what keeps this resource inside ADR-0033's carve-out rather than beside the credentials the carve-out exists to protect.

## Decision

### Storage: one table per population, with a real foreign key

```
staff_settings                                        user_settings
--------------                                        -------------
id          uuid pk                  -- primaryId()   id          uuid pk
staff_id    uuid not null unique                      user_id     uuid not null unique
            references staff(id) on delete cascade                references users(id) on delete cascade
theme       theme  enum not null default 'system'     (same)
locale      locale enum not null default 'en'         (same)
grids       jsonb       not null default '{}'         (same)
created_at, updated_at               -- timestamps()  (same)
```

- **Two tables, column-for-column identical today, by decision rather than by accident.** The operator's call at opening, on the one fact the scoping sketch underweighted: staff settings and customer settings will diverge — an operator's panel and a customer's app want different knobs — and the `sessions` shape diverges by sprouting nullable columns that one population never fills, which is exactly what [ADR-0017](0017-identity-model-populations-and-roles.md) refused for accounts. Separate aggregates also get what `sessions` could not have: `principal_id` there carries no foreign key because Postgres cannot express a polymorphic one, so the service sweeps sessions by hand when a principal goes; `staff_id` and `user_id` here reference one table each, and the database does the sweeping (§Deletion). The `unique` on the principal column is what makes "this principal's settings" a single row and the upsert below a single statement.
- **`theme` and `locale` are Postgres enums built from `@repo/contracts` tuples** — `pgEnum("theme", THEMES)` and `pgEnum("locale", LOCALES)` in `_shared.ts`, under ADR-0023's one-declaration rule. `LOCALES` is `["en"]` today; D7 appends `"lv"`, which is `ALTER TYPE … ADD VALUE` — appending, as `_shared.ts` already notes, so no row and no sort order moves.
- **`grids` is `jsonb`, default `{}`**, a record of `gridId → grid-preferences object`. It is the one column whose shape the database does not check, and it does not need to: every value that reaches it has passed `gridPreferencesSchema` in the request body (§Endpoints), and every value that leaves it passes the same schema in the client store (§Contracts). The server stores what it validated and returns what it stored.
- **No row means defaults.** Nothing creates a settings row at registration, at staff creation or at login; the first `PATCH` creates it (upsert). A principal who never touched a setting has no row, and `GET` answers the defaults resource for them — which is the same answer a row holding the defaults would give, so nothing downstream can tell the two apart.

#### Deletion

The hard-delete path needs **no settings code**: `on delete cascade` removes the row when `DELETE /admin/staff/:id` ([ADR-0028](0028-account-deletion.md) §Staff — hard delete) removes the account, in the same statement — stronger than the same-transaction sweep ADR-0028 has to perform for sessions, because a constraint cannot be forgotten by the next hard-delete path somebody adds. **Users have no hard delete** — ADR-0028 soft-deletes them and rejected the hard alternative — and a soft-deleted user keeps their row because their `users` row stays: the account is retained by design, and if a restore path ever exists the arrangement should still be there. The staff service takes no settings dependency; the integration test asserts the cascade rather than trusting it.

### Endpoints: `GET` and `PATCH /settings`, self-scoped, on both segments

```
GET   /api/v1/admin/settings     staff principal     → 200 StaffSettingsResource
PATCH /api/v1/admin/settings     staff principal     → 200 StaffSettingsResource
GET   /api/v1/user/settings      user principal      → 200 UserSettingsResource
PATCH /api/v1/user/settings      user principal      → 200 UserSettingsResource
```

- **Amended 2026-08-22 (D6.2): the router carries `no-store`, like every authenticated router beside it.** Not stated above, and settled by consistency rather than by sensitivity: a settings response is one operator's arrangement and holds nothing a credential could be reached through, but a shared proxy that kept a page of it would hand the next caller somebody else's. RFC 9111 already stops a shared cache storing a response to a request carrying `Authorization`; this is the belt to those suspenders, and it is the same directive `/profile`, `/staff` and `/users` apply for the same reason (ADR-0020).
- **Mounted beside `/profile`, inside the segment's `authenticate`, with no `authorize`** — the routers' own justification for `/profile` applies word for word: every handler reads its subject from `ctx.principal`, there is no `:id` to compare, and so the ownership question ADR-0019 §3 asks has no way to be answered wrongly. Every staff role, `editor` included, may read and write its own settings; every customer may read and write theirs.
- **One module, one service, one controller, two mounts — and two repository halves.** `ctx.principal` carries `kind` and `id`, so the service picks the `staff` or `user` half of the repository by the population and nothing is configured per mount. The `/profile` precedent has two routers because the two profiles differ in shape (ADR-0017); the two settings are the same shape **today**, so there is one router factory called twice — and the place they are allowed to stop being the same shape is the contracts pair (§Contracts), not a flag on the service.
- **`GET` never answers `404`.** No row is the defaults resource, and the client is never asked to distinguish "you have no settings" from "your settings are the defaults".

  **Amended 2026-08-22 (D6.4): a row is validated on the way in and not on the way out.** Nothing above says what `GET` does with a `grids` column that no longer satisfies `gridPreferencesSchema` — a possibility this record creates by putting the value in `jsonb`, where a `psql` session can write what the body schema would have refused. The close-out checklist asks for it (`docs/plan/0006-user-settings.md` §Definition of done item 4) and had no tier that answered it: the client's half was covered in jsdom, and the client only reaches its guard if the request it made came back.

  It comes back. The mapper hands the stored value on untouched, `respond.ok` does not re-validate, and the client's schema is the guard — an entry it refuses is discarded on read and the grid renders at its config defaults (ADR-0041 `D4.5`). That is the right division and it is now asserted rather than assumed, but it has to be said out loud, because the alternative reading — validate on read, refuse or repair — is the one a reviewer will propose: a `500` would make one hand-edited row lock an operator out of every grid, and a silent repair would write a value nobody asked for over one somebody meant. So the API's contract is about what it **accepts**, and a row that got round that contract is the client's to survive.
- **`PATCH` is a merge, and `grids` merges per key.** The body is `.strict()` with every key optional. `theme` and `locale`, when present, replace. `grids`, when present, is applied **entry by entry**: a key whose value is an object replaces that grid's entry; a key whose value is `null` deletes it; a key absent from the body is untouched. The response is the full resource after the merge, via `respond.ok` — the client gets back what the server now holds, which is what lets it reconcile rather than assume.

  **The merge executes against the fresh row under a lock.** The service opens a transaction, reads the principal's row `FOR UPDATE` (or finds none), applies a pure `mergeGrids(current, patch)` and the scalar replacements, checks the result against the stored bound, and upserts. Two tabs — or a tab and a phone — patching different grids at once serialise on the row and both land; two patching the same grid serialise and the later one wins for that key, which is the same last-write-wins ADR-0041 accepted for two tabs on one device. A `PUT` that replaced the whole document could not make that promise (§Alternatives).

  **Amended 2026-08-22 (D6.2): the row is created before it is locked, and “or finds none” is the case that had to go.** As written, the sequence above reads the row `FOR UPDATE` — *or finds none* — and upserts at the end, and that pair has a race the paragraph then denies. `select … for update` locks the rows it **finds**, and a principal's first-ever `PATCH` finds none, so two of them lock nothing, both merge against an empty row, and the second upsert erases the first's grids. It is the exact outcome per-key merging exists to prevent, arriving through the one case the merge cannot see.

  So the repository's `findForUpdate` is `lockForUpdate`, and it inserts the defaults row with `on conflict do nothing` **before** the locking read. That is enough on its own: when a concurrent transaction has inserted but not committed, Postgres makes the conflicting insert *wait* for it, so by the time the lock is taken there is exactly one row and the second transaction reads what the first actually wrote. No retry loop, no advisory lock, and the write at the end is a plain `update` because the row is guaranteed. A patch that then fails its bound leaves nothing behind — the insert is inside the caller's transaction and rolls back with it, which the integration suite asserts rather than assumes.

  **Amended 2026-08-22 (D6.1): an empty body is accepted, and answers the resource unchanged.** The text above says "every key optional" and stops there, which leaves `{}` to be settled by whoever writes the schema — and the repository's own precedent points the wrong way: `updateUserBody` refuses an empty patch, because a caller naming no field made a mistake. This body has a different caller. It is written by the debounced coalescing writer of §The server adapter, and a flush that finds nothing left to say is a race the client should not have to detect; refusing it would turn a harmless no-op into the one failure toast this resource declares. So `{}` is a valid patch, the merge is the identity, and the response is the current resource.

- **Bounds live in the body schema, and one bound lives in the merge.** A grid id is `z.string().min(1).max(64)`; a body carries at most 50 grid keys; each entry is validated by `gridPreferencesSchema` (§Contracts), which clamps widths to 64–2000, ids to `min(1).max(64)` and arrays to 200 entries. The one bound a body cannot check alone — **at most 50 grid entries in the stored row** — is checked on the merged result inside the transaction, because forty existing keys plus twenty new ones is a valid body and an invalid row. It is refused with plain `VALIDATION_ERROR` and a detail naming `grids`.
- **No new error code.** Validation is `VALIDATION_ERROR` ([ADR-0013](0013-error-model.md)); there is no conflict state, no foreign row and no standing question, so nothing else can be thrown. The module has no `settings.errors.ts` until a code arises, and none is expected.

### The module

`apps/api/src/modules/settings`, in ADR-0009's fixed shape:

```
modules/settings/
├── settings.routes.ts       # createSettingsRouter(controller): GET /, PATCH /
├── settings.controller.ts   # createSettingsController(service): ctx first, respond.ok
├── settings.service.ts      # createSettingsService(deps): defaults, merge, bounds
├── settings.repository.ts   # createSettingsRepository(db): { staff, user } — one signature, two tables: findById, findForUpdate, upsert
├── settings.schemas.ts      # re-exports from @repo/contracts (the body pair)
├── settings.mapper.ts       # toSettingsResource(row | null): row → resource, null → defaults
└── __tests__/
```

```ts
// settings.service.ts — shape, not source
type Deps = {
  readonly repository: SettingsRepository;
  readonly transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
};

export const createSettingsService = ({ repository, transaction }: Deps) => {
  /** The only place a population becomes a table. */
  const tableFor = (ctx: RequestContext) => repository[ctx.principal.kind];

  return {
    get: async (ctx: RequestContext): Promise<SettingsResource> =>
      toSettingsResource(await tableFor(ctx).findById(ctx.principal.id)),

    update: (ctx: RequestContext, body: UpdateSettingsBody): Promise<SettingsResource> =>
      transaction(async (tx) => {
        const table = tableFor(ctx);
        const current = await table.findForUpdate(ctx.principal.id, tx);
        const next = applyPatch(current, body);        // pure: theme/locale replace, grids per-key merge
        assertGridCount(next.grids);                    // ≤ MAX_SETTINGS_GRIDS, else validation()
        return toSettingsResource(await table.upsert(ctx.principal.id, next, tx));
      }),
  } as const;
};
```

`tableFor(ctx)` is `repository[ctx.principal.kind]` — the only place the request's population is turned into a table, so it cannot be spelled two ways, and the two halves share one signature so the service never branches on it again. `SettingsResource` and `UpdateSettingsBody` in the sample are the shared core the two contracts exports are composed from (§Contracts); the day the pair diverges, `update` is the function that splits with it. `applyPatch` and `mergeGrids` are pure and unit-tested without a database; the repository tests run the lock and the upsert against the test database, for both halves ([ADR-0021](0021-testing-strategy.md)).

### Contracts (`@repo/contracts`)

```
packages/contracts/src/settings/
├── enums.ts      # THEMES, Theme; LOCALES, Locale
├── schemas.ts    # gridPreferencesSchema (v1), the settings core, updateStaffSettingsBody, updateUserSettingsBody, the bounds
├── types.ts      # SettingsCore, StaffSettingsResource, UserSettingsResource, GridPreferencesV1
└── index.ts
```

```ts
export const THEMES = ["light", "dark", "system"] as const;
export const LOCALES = ["en"] as const;               // D7 appends "lv"

export const MIN_COLUMN_WIDTH = 64;
export const MAX_COLUMN_WIDTH = 2_000;
export const MAX_GRID_COLUMNS = 200;
export const MAX_SETTINGS_GRIDS = 50;
const columnId = z.string().min(1).max(64);
const gridId = z.string().min(1).max(64);

/** Version 1 — moved here from apps/admin/src/shared/grid/preferences.ts, unchanged. */
export const gridPreferencesSchema = z.object({
  v: z.literal(1),
  sizing: z.record(columnId, z.number().int().min(MIN_COLUMN_WIDTH).max(MAX_COLUMN_WIDTH)),
  order: z.array(columnId).max(MAX_GRID_COLUMNS),
  hidden: z.array(columnId).max(MAX_GRID_COLUMNS),
});

const settingsPatch = z.object({
  theme: z.enum(THEMES).optional(),
  locale: z.enum(LOCALES).optional(),
  grids: z
    .record(gridId, gridPreferencesSchema.nullable())   // null = delete this key
    .refine((g) => Object.keys(g).length <= MAX_SETTINGS_GRIDS)
    .optional(),
});

/** One core, two exports — identical today by construction, free to diverge. */
export const updateStaffSettingsBody = settingsPatch.strict();
export const updateUserSettingsBody = settingsPatch.strict();

interface SettingsCore {
  readonly theme: Theme;
  readonly locale: Locale;
  readonly grids: Readonly<Record<string, GridPreferencesV1>>;
}
export type StaffSettingsResource = SettingsCore;
export type UserSettingsResource = SettingsCore;
```

- **A pair composed from one core, exported separately.** `StaffSettingsResource` and `UserSettingsResource` are the same type today, and that is a fact about today: when a customer setting arrives that staff have no use for — or the reverse — it is added to one export, the matching table gains the column, and that population's service function splits off the shared one. The pair is the split point; nothing else in this record has to change for the two to diverge, which is why there are two names for one shape now rather than one name and a rename later. The MSW handlers and the admin entity slice consume the staff pair; the D8 customer app will consume the user pair.
- **`gridPreferencesSchema` moves, and it moves intact.** ADR-0041 put the schema "beside the store, not in `@repo/contracts` — nothing on the wire speaks it today; the day the user-settings API does, moving it there is that ADR's work." This is that day and this is that work. The schema, its `v: 1` literal and the three bounds its D4.5 amendment set — widths clamped 64–2000, ids `min(1).max(64)`, arrays of at most 200 — are relocated without a change of meaning. `apps/admin/src/shared/grid/preferences.ts` imports it from contracts and is **otherwise unchanged**: same `PreferenceStorage`, same `createGridPreferences`, same `load`/`persist` guards, same `gridStorageKey`. That is ADR-0041's claim being held, not merely cited.
  **Amended 2026-08-22 (D6.1): “intact” includes its strictness, which is `z.object` and not `z.strictObject`.** The body around it is strict and the entry inside it is not, which reads like an oversight until the two directions are separated. A strict body refuses a misspelled key at the edge, where a caller can be told. A strict *entry* would discard a whole grid's arrangement over one field a newer client added — the exact opposite of what the version-tolerance in the next sentence is for. The store has always stripped rather than refused, so the schema keeps stripping, and the property is now asserted in the contracts suite rather than left to the reader.

- **Validated on the way in by the API, and on the way out by the client store.** The server refuses a body whose entry fails the schema; the store still `safeParse`s what the adapter hands it and falls back to defaults on failure — the guard ADR-0041's D4.5 amendment made the _store's_ guarantee rather than an adapter's courtesy stays exactly where it is. The server returns stored JSON as it stored it, so a future version-2 entry written by a newer client reaches an older client as a value that older client's schema discards silently, which is what "corrupt preferences must never break a grid" already requires.
- **Amended 2026-08-22 (D6.2): `GridPreferencesV1` is the schema's own output, not a hand-written twin.** The sketch above names it beside the resource types, and this package writes resource types by hand — so the first attempt wrote it by hand too, with `readonly` members like every other. It does not work here, and the reason is specific to this one type: it is the value in the resource's `grids` **and** the value in the body's `grids`, so it is on both sides of the wire. zod infers mutable arrays, the interface declared `readonly string[]`, and the result was that a client could not send back a value it had just been given. The service's unit tests found it the first time a patch was built from a resource. One declaration cannot drift from itself, so the type is `z.infer<typeof gridPreferencesSchema>` and `Readonly` is applied where it is *used* — on the record in `SettingsCore` — rather than inside it.
- **Amended 2026-08-22 (D6.2): the defaults are declared once too.** The storage table above spells `default 'system'` and `default 'en'`, and §Endpoints says a principal with no row gets “the defaults” — two spellings of one fact, in a package and in a mapper, and a drift between them would be invisible because both paths answer a valid resource and only the values differ. `DEFAULT_THEME` and `DEFAULT_LOCALE` join the tuples in `@repo/contracts`, and the `pgEnum` column defaults and the mapper's no-row answer are both built from them (ADR-0023).
- **The resource has no `id` and no timestamps.** The subject is the principal, which the caller already is; `updatedAt` would answer a question nothing asks, and ADR-0012 §Resource shape rules requires ISO timestamps where they appear, not that they appear.
- **Enums consumed as everywhere else**: `pgEnum` in `packages/db/src/schema/_shared.ts`, `z.enum` in the body schema, the union type in the clients. The admin theme provider's own `THEMES` tuple is deleted in favour of the contracts one — two declarations of the same set is the drift ADR-0023 exists to prevent.

### The client (`apps/admin`)

#### An entity slice, and a settings query at bootstrap

`entities/settings` in the flat `<entity>.<layer>.ts` form ADR-0043 keeps: `settings.keys.ts` (`settingsKeys.all`), `settings.api.ts` (`createSettingsApi(client)` with `get` and `update`), `settings.queries.ts` (`useSettings`, `useUpdateSettings`).

**The settings query runs at session bootstrap, alongside the principal, and the boot gate waits for it to settle.** One more round trip after ADR-0033's csrf-then-refresh, and the reason it is paid rather than deferred is the adapter below: `read` is synchronous, grids read their storage once at mount, and a grid that mounts before the mirror is seeded reads the local cache and never hears about the server's answer. A settled query — success or failure — before any dashboard route renders is what makes the first-sync rule run exactly once, before any store exists. A failed settings read is not a gate failure: it resolves to "local only", which is the app the operator had before this deliverable.

**Amended 2026-08-22 (D6.3): "settled" is `enabled: false`'s problem, and the query is pinned against background refetches.** Two things the paragraph above leaves to the implementer, and each has one wrong reading that compiles.

"A settled query — success or failure" reads as `isSuccess || isError`, and an anonymous visitor never reaches either: the query is `enabled: false`, which leaves it `isPending` with an idle `fetchStatus` **forever**, so a gate spelled that way holds the login screen behind a loader that will never resolve. The gate is therefore "nothing is in flight for us to wait on" — `isAuthenticated && isPending && fetchStatus !== "idle"` — and an anonymous visitor pays nothing, which is what this record already promised them.

And the query carries `staleTime: Infinity` with `refetchOnWindowFocus: false`, against the app's own defaults of thirty seconds and refetch-on-focus (ADR-0043). The mirror is the working copy and this cache entry is its backing store: a background refetch on window focus would re-seed the mirror from the server mid-session, which is a column snapping back under an operator who has just dragged it. The only thing that writes this entry is the mutation's own `onSuccess`, which is the response to what this client just said.

#### The server adapter — the same three functions

```ts
// entities/settings/settings.storage.ts
export const createServerPreferenceAdapter = ({ writer, cache }: {
  readonly writer: SettingsWriter;          // mirror + debounced PATCH, below
  readonly cache: PreferenceStorage;        // createLocalStorageAdapter()
}): PreferenceStorage => ({
  read: (key) => writer.readGrid(parseGridStorageKey(key)) ?? cache.read(key),
  write: (key, value) => { cache.write(key, value); writer.setGrid(parseGridStorageKey(key), value); },
  remove: (key) => { cache.remove(key); writer.setGrid(parseGridStorageKey(key), null); },
});
```

- **It is a `PreferenceStorage` and nothing more.** `read` is synchronous from an in-memory mirror seeded by the settings query; `write` and `remove` update the mirror and the local cache, then schedule the PATCH. The store does not know a network exists, which is the property ADR-0041's guards were written for: a write that fails degrades to "not persisting", never to a broken grid.
- **The adapter owns the key ↔ `gridId` mapping.** The store speaks `machxi.admin.grid:<gridId>:v1`; the wire speaks `grids[gridId]`. `parseGridStorageKey` is the inverse of ADR-0041's `gridStorageKey`, exported beside it so the format is spelled in one file — an additive helper next to the store, not a change to it. A key the adapter cannot parse (a different prefix, a different version) falls through to the local cache and is never sent. The store never learns that a `gridId` is on the wire.
- **One debounced writer coalesces every setting.** `createSettingsWriter` holds the mirror, a pending patch and a ~1 s timer; successive `setGrid` and `setTheme` calls within the window collapse into **one** `PATCH` carrying only the changed keys — a resized column and a toggled theme in the same second are one request. Per-key merge semantics on the server are what make sending only the changed entries safe: the body says "this grid, this theme" and is silent about everything else. The PATCH goes through `useUpdateSettings`, whose `onSuccess` re-seeds the mirror from the response. A pending write when the tab closes is lost, and that is the "not persisting" outcome accepted rather than fought with `sendBeacon` (which cannot carry the bearer token).

  **Amended 2026-08-22 (D6.3): the writer is subscribed to; it does not hold the mutation.** "The PATCH goes through `useUpdateSettings`" is right about where the request is made and wrong about who holds the function that makes it. `mutateAsync` belongs to a component and is a render-time value, so a writer built with one at construction holds whichever it was handed first — and the workaround for that, a ref refreshed during render, is refused outright by React's own lint before it can be argued about.

  The writer therefore takes no sender at all. It exposes `subscribe(send)`, which the provider installs from an effect and which returns its own remover — the observable shape ADR-0033's session store established and every other store here has copied, and the reason this file still knows nothing about React or about requests. One consequence had to be designed rather than discovered: a grid can be adopted during the render *before* that effect runs, so a flush with no subscriber keeps its pending payload instead of dropping it, and `subscribe` flushes on arrival.
- **The first-sync merge rule.** When the settings query resolves, for each grid key: **the server entry wins if present**; a key that exists only in the local cache is **adopted and uploaded once**. Nobody loses the arrangement they built before the API existed, and a second device never overwrites the first device's uploaded arrangement with a stale local one. Later refetches re-seed the mirror with server entries except for keys with a write still pending in the debounce window.

  **Amended 2026-08-22 (D6.3): "for each grid key" is per key on its first read, because the seam cannot be enumerated.** The rule above is written as a sweep at resolve time, and a sweep needs a list of the local cache's keys. `PreferenceStorage` has three functions — `read`, `write`, `remove` — and none of them lists anything; asking for a fourth would be widening the interface ADR-0041 cut, on the very step scheduled to prove it did not need widening.

  So adoption happens where the question is actually asked. The first `read` of `machxi.admin.grid:<gridId>:v1` that the mirror cannot answer consults the cache, and a well-formed entry is adopted and queued for upload right there; every grid id is decided exactly once per session. The observable outcome is the same for every grid an operator opens, and strictly more conservative for one they do not: a device that has never shown the users grid does not push its stale arrangement of it. What a well-formed entry means is checked rather than assumed — an entry the schema refuses is left to the device and never uploaded, so a corrupt local cache cannot become the account's corruption.
- **`localStorage` stays, as the cache in front of the server.** It is ADR-0033's carve-out and ADR-0041's first adapter, and two things need it: the theme before first paint, when there is no session to ask, and the signed-out app, which themes the login screen from the cache as today. Signed out, the app uses the local adapter alone, unchanged.
- **Where the adapter is supplied.** `useGridPreferences` today resolves `storage ?? createLocalStorageAdapter()` itself and says in its own header that it is "the reason the future server-backed adapter changes one file rather than a component tree". It is that one file: the default becomes a `PreferenceStorageProvider` context in `shared/grid` whose value `app/providers` sets to the server adapter for an authenticated session and leaves at `localStorage` otherwise. `AppGrid`'s `storage` prop stays as the per-call-site override; `createGridPreferences` and `AppGrid` do not change. Said plainly so the claim is auditable: **the store and AppGrid do not change; the React binding's default-adapter line and one import in the store's file do.**

  **Amended 2026-08-22 (D6.3): what the audit actually shows, counted rather than promised.** `apps/admin/src/shared/grid/app-grid.tsx` has **no diff at all** since D5 — the sentence above is exact about it. `preferences.ts` has three: `D6.1`'s schema import and re-export, the schema body it deleted, and `D6.3`'s `parseGridStorageKey`, which this record put there itself one bullet above.

  So `docs/plan/0006-user-settings.md` §Definition of done item 2 — "shows the schema import and nothing else" — is false as written, and it is worth being precise about what that costs rather than reworded to fit. `createGridPreferences`, its `load` and `persist` guards, `reconcile`, `gridStorageKey`, `clampColumnWidth` and both adapters are unchanged apart from the schema's new name; nothing above the seam moved; the React binding's default-adapter line changed as predicted. The claim ADR-0041 asked to be held to is about **the store and `AppGrid`**, and it holds. The file gained an exported pure function that the store does not call, which is a different and much smaller fact than the one item 2 was written to catch.

#### Theme

`"system"` means the media query. The provider applies the stored or local theme before first paint exactly as today (`applyTheme(preferredTheme())` in `main.tsx`, reading `machxi.admin.theme`, now possibly `"system"`), then adopts the server theme when the settings query resolves, and toggling writes **both** — the local cache synchronously, the server through the same coalescing writer. The local key may now hold `"system"`, which `preferredTheme` resolves through `prefers-color-scheme` at apply time.

**Amended 2026-08-22 (D6.3): there was no toggle, and building one moved the theme's pure half into `shared`.** "Toggling writes both" assumes a control that toggles, and none existed. `app/providers/theme.ts` shipped at `D3.1` with `applyTheme`, `preferredTheme` and `readStoredTheme`, called from `main.tsx` before the first paint and from nowhere else; its own header deferred a provider with a toggle to `D3.9`, "once there is a header to put it in", and `D3.9` built the header and not the toggle. So the theme has been an account fact this record could describe and an operator could not change since the moment it became one.

`D6.3` adds the control — a three-option radio group (`THEMES`, so a value D7 appends cannot leave a control behind) in the account menu `widgets/app-sidebar` already owns, as `features/theme`. That placement decides the rest: a feature and a widget may not import from `app` (ADR-0032), so `useTheme` cannot live beside its provider, and neither can the `applyTheme` a context default has to call. The pure half moves to **`shared/theme`** — the rule ADR-0032 states in the same breath as the layer arrows, and the call `D3.4` already made for `useApiClient` — while the *provider* stays `app/providers`', rendered by `SettingsProvider`, which is what ADR-0032's tree names. `main.tsx` imports the same two functions from the new path and applies the theme before the first paint exactly as before.

The provider carries one thing the paragraph above does not: an **adoption latch**. The account's theme is applied once per distinct value, because re-applying it on every render where it differs from the operator's current choice would spring a toggle back to the last saved value in the second before the write lands.

#### Notifications and locale

- **Settings writes declare no success toast** (ADR-0043 `meta`): a column resize is not an outcome an operator needs told. The global error handler's one toast on failure stays — coalesced, so a flaky connection costs one toast per flush and not one per pixel.
- **`locale` is carried and inert.** It is validated, stored, returned and displayed nowhere; there is no switch and no dictionary. D7 owns both, and finds the slot already on the wire.

### Security and privacy, said plainly

- A settings row holds **display state only**: column ids and widths, a theme, a locale. Never row data, never a filter value, never anything typed into the grid — ADR-0041's line, now enforced on the server by a schema that has no field such a thing could live in.
- It is **non-credential display state under ADR-0033's carve-out**; the local cache persists the same facts `localStorage` already held for the theme and the grids, and nothing new enters it.
- **An authenticated principal reads and writes its own row and no other.** There is no `:id`, so there is no parameter to tamper with; the row key comes from `ctx.principal`, which `authenticate` set. An `admin` cannot read a colleague's settings, and the customer segment and the admin segment cannot reach each other's rows because they read different tables: the staff segment selects the `staff` half of the repository and the user segment the `user` half, by `ctx.principal.kind` and nothing a request supplies.
- The one cross-account seam is the **device**: the local cache is per browser, not per account, so a second account signing in on the same machine adopts the first account's local-only grid entries on its first sync. What leaks is which columns somebody on this machine prefers wide. Recorded rather than engineered around; namespacing the cache by principal would put an id in `localStorage`, which ADR-0033 forbids.

## Consequences

- **ADR-0041's claim is held, and where it bends, the bend is written down.** The store, its guards and `AppGrid` are untouched; the schema moves with its meaning intact; one default-adapter line in the React binding changes, which that file predicted of itself. `D6.3` is the falsification run, and a second file changing above the seam is the finding that amends this record.
- **Theme and grid arrangement become account facts.** The acceptance sketch in `docs/plan/0006-user-settings.md` — sign in elsewhere and find the first browser's theme and arrangement — is now a property of the API rather than of a device.
- **D7 inherits the locale slot.** `LOCALES` gains `"lv"` by append, `locale` is already on the resource and in the row, and the switch D7 builds writes through `useUpdateSettings` like the theme does. Nothing in persistence is D7's to design.
- **D8 inherits `/user/settings` already existing**, with the same resource and the same merge semantics. The `entities/settings` slice, the coalescing writer and the server adapter are the first clear **extraction candidates** for whatever `apps/customer` shares with `apps/admin` — ADR-0033 deferred extracting the API client until a second consumer existed, and this slice will face the same question on the same day.
- **Boot costs one more round trip for an authenticated session.** Three requests before the first protected render instead of two, paid so that every grid reads a seeded mirror. Anonymous visitors pay nothing; a failing settings endpoint costs the round trip and nothing else.
- **The gap that stays open: no saved views.** Sort, filters and pagination are **not** persisted here, and ADR-0041 §Alternatives says why: they are view state, the URL owns them ([ADR-0043](0043-readable-list-search-params.md)), and a second owner is the drift the URL decision exists to prevent — "the same state with two owners, disagreeing after the first reload". Named, shareable bundles of view state are a different and bigger decision, and a settings row that never holds a filter value is also how the privacy line above stays a structural fact rather than a review item.
- **The index's Planned bullet for a user-settings API is closed by this record.** The seam and the versioned value were "the ready-made contract"; they were, and they were enough.
- **Two enums join the schema, and one of them is expected to grow.** Adding a locale is a migration plus one tuple edit, in that order, and a sort by `locale` follows declaration order — the `_shared.ts` rule, now applying to a column no list endpoint sorts by today.
- **Multi-device is last-write-wins per grid key, and deliberately not merged deeper.** Two devices resizing the same grid within each other's debounce windows end with one device's widths. The same wrinkle ADR-0041 accepted for two tabs, now across machines, with the same judgement: an ergonomics disagreement, not a correctness problem.
- **The tests are enumerable.** Contracts: the moved schema's existing bounds, the body's strictness and `null` deletes. API: `GET` with no row is the defaults; `PATCH` creates, merges per key, deletes on `null`, refuses the 51st grid, never leaks another principal's row across either segment; the staff hard delete cascades the row away. Admin (ADR-0036, MSW from the contracts schema): the adapter's three functions against a scripted settings handler; the first-sync rule in both directions; one `PATCH` for a burst of writes; a failed write leaving the grid usable; the signed-out app theming from the cache.

## Alternatives considered

- **One `settings` table, discriminated by `principal_type` + `principal_id` — the `sessions` shape.** One row shape, one repository, one unique index, and the scoping sketch's own first answer. It loses on two counts. There is no foreign key — `sessions.ts` is explicit that its discriminator stands in for one Postgres cannot express — so the service would sweep settings by hand on every hard-delete path, today's and every one added later. And it assumes the two populations' settings stay one shape, when the ADR-0017 precedent and the product both say they will not: a discriminated table diverges by adding columns one population leaves null, and at that point it is two tables pretending to be one. Two tables that are identical today cost one more migration file and nothing in the service, which selects a half by population and never branches again.
- **A generic key-value settings bag** (`key text, value jsonb`). Infinitely flexible, and it makes the database unable to say what a setting is: no enum on `theme`, no bound on what `grids` holds, a `locale` that could be any string, and a client that has to know the key names anyway. A typed resource is what lets the body schema refuse garbage at the edge and lets D7 add a column rather than a convention.
- **Persist preferences in the JWT or the session row.** No new table, and the settings ride with the principal. Rejected twice over: the access token is fifteen minutes of claims that `authorize` reads for roles, and every resize would want a new token; the session row is per device by definition, which is the thing this ADR exists to stop being true.
- **`PUT` the whole document instead of a per-key `PATCH`.** Simpler schema, simpler repository, one statement with no lock. It loses the moment two tabs are open: tab A resizes the staff grid, tab B hides a users column, and whichever writes second erases the other's grid from the document, because each sent the whole of what it knew. Per-key merge means a body is a statement about the keys it names and silence about the rest, and silence cannot erase anything.
- **Server-only, no `localStorage` cache.** The honest end state for a multi-device operator, and it cannot theme the first paint — there is no session before ADR-0033's bootstrap settles, and a login screen that flashes light before the operator's dark arrives is the defect the pre-paint apply exists to prevent. The signed-out app would have no theme at all. The cache stays, and it is exactly what ADR-0041 and ADR-0033 already permitted.
- **Do not gate boot on the settings query.** Saves a round trip and breaks the first-sync rule: a grid that mounts first reads the cache, the server's arrangement arrives to a store that has already loaded, and the operator sees the local layout until their next navigation. Remounting grids on arrival is the uglier fix. One request is the cheaper price.
