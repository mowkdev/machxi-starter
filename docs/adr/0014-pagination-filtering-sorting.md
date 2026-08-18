# ADR-0014: Pagination, filtering and sorting conventions

- Status: accepted
- Date: 2026-08-17

## Context

List endpoints must be paginated (offset-based per requirement), filterable and sortable in a way that is consistent across modules, safe (bounded page size, allow-listed sort/filter fields) and easy to implement per module without re-inventing query parsing.

## Decision

### Query parameters

| Param | Type | Default | Rules |
|---|---|---|---|
| `offset` | int ≥ 0 | 0 | |
| `limit` | int 1..100 | 20 | max configurable per endpoint, hard cap 100 (`limit=0` is invalid) |
| `sort` | string | endpoint default (`-createdAt`) | comma-separated fields; leading `-` = desc; only allow-listed fields |
| `filter[<field>]` | string | — | equality by default; operator suffix for others (below); allow-listed fields |
| `q` | string | — | free-text search when the endpoint supports it (endpoint defines which columns) |

Filter operators (bracket syntax, URL-encodable, Postman-friendly):

```
filter[status]=active                 eq
filter[status][in]=active,invited     in   (comma list)
filter[createdAt][gte]=2026-01-01     gte | gt | lte | lt
filter[email][like]=%40acme.com       like (case-insensitive ILIKE)
filter[deletedAt][null]=true          is null / is not null
```

Example: `GET /api/v1/admin/users?offset=20&limit=20&sort=-createdAt,email&filter[status]=active&q=anna`

### Server-side building blocks

```ts
// packages/contracts/src/list-query.ts   (amended 2026-08-18, see below)
export const listQuerySchema = (opts: { sortable: readonly string[]; filterable: FilterSpec; maxLimit?: number; defaultSort: string }) =>
  z.object({ offset, limit, sort, filter, q }) // returns a zod schema producing ListQuery

export interface ListQuery {
  offset: number; limit: number;
  sort: { field: string; direction: 'asc' | 'desc' }[];
  filters: Filter[];        // { field, op, value }
  q?: string;
}
export interface Page<T> { items: T[]; total: number | null; offset: number; limit: number; sort: SortSpec[]; filters: Record<string, unknown> }
```

**Amended 2026-08-18 (implementation step 4).** This section originally placed `listQuerySchema` in `apps/api/src/core/http/list-query.ts`. It lives in **`@repo/contracts`** instead, because ADR-0023 puts `listStaffQuery` / `listUsersQuery` in that package and a per-module query schema cannot be built without the builder. Nothing is lost: the builder is pure zod, and the seam stays where it matters — `applyListQuery`, the column map and the `id asc` tiebreaker are Drizzle-side and remain in `apps/api/src/core/http/list-query.ts`, which re-exports the builder so module code has one import. `ListQuery`, `Filter`, `FilterOp`, `FilterSpec`, `Page<T>` and `filtersToRecord` ship from contracts for the same reason: an admin table needs them to type a list response, and none of them touches an ORM.

Three behaviours the decision above did not settle, fixed by the implementation:

- `defaultLimit` defaults to `min(20, maxLimit)`, so an endpoint that lowers its ceiling does not also have to restate its page size.
- A configuration that contradicts itself — `defaultSort` naming a non-sortable field, `maxLimit` above the hard cap of 100, `defaultLimit` above `maxLimit` — throws a `TypeError` when the schema is built, i.e. when the router is wired, rather than failing on the first request.
- The `id asc` tiebreaker is **not** added to the parsed `sort` and therefore never appears in `meta.sort`. It is a statement about SQL determinism, not about what the client asked for, so it belongs to `applyListQuery`.

**Amended 2026-08-18 (step 7), on the API side of the seam.** `applyListQuery`
returns the *parts* of the query — `{ where, orderBy, limit, offset }` — rather
than taking a query builder and handing one back: Drizzle's builder is chained
and its type changes at every step, so passing it through a helper is what loses
the row type. The repository spreads the parts over its own `select()`.

Two constraints on the pairing a module declares, both of which fail loudly
rather than silently:

- A field that the query schema admits but the module's column map omits throws
  when the request is built. It is not a client error — the allow-list already
  rejected anything outside it — so it surfaces as a `500` with a stack, which is
  what a wiring bug deserves.
- A filter's `value` schema must parse to the **column's TypeScript type**, not
  to a string. Drizzle binds a parameter through the column's own driver mapper,
  so a `timestamp` column needs `value: z.coerce.date()`; leaving it as the
  default string throws inside the mapper. The value echoed in `meta.filters` is
  therefore the parsed one — the ISO-8601 instant that was applied, not the raw
  query string that produced it, which is also what ADR-0012 asks for.

- Each module declares its allow-lists once in `<module>.schemas.ts` (`sortable: ['createdAt','email','status'] as const`) and derives its query schema with `listQuerySchema`. Unknown sort/filter fields → `VALIDATION_ERROR`.
- Repositories translate `ListQuery` to Drizzle with a shared helper `applyListQuery(qb, query, columnMap)` (maps API field → column, applies `where`, `orderBy`, `limit/offset`) and run `count(*)` for `total` in the same transaction (or a single query with a window function `count(*) over()` — implementation detail, helper hides it).
- Services return `Page<T>`; controllers call `respond.list(res, page)` (ADR-0012), which emits `meta.pagination = { offset, limit, total }`, `meta.sort`, `meta.filters` so the client can render state without re-parsing its own query.

**Amended 2026-08-18 (step 9), by the first two list endpoints.** Three things
the decision left to "the endpoint defines which columns".

- **`q` is a term, not a pattern.** It is applied as an OR of case-insensitive
  containment (`ILIKE`) over the columns the module declares searchable —
  `email`, `first_name`, `last_name` for both `staff` and `users` — and the term is run
  through `escapeLikePattern` first, so `%`, `_` and `\` match themselves. A
  client searching for `100%` means the four characters; leaving the `%`
  unescaped would silently turn that request into "match every row", which is
  the difference between a filter and no filter. `like` filters are the
  opposite and are **not** escaped: `filter[email][like]=%40acme.com` is a
  pattern the client wrote on purpose.
- **A default scope steps aside when the client asks about it.**
  `GET /api/v1/admin/users` hides soft-deleted rows, because "the account is
  gone" has to be true on the screen where it matters most. But `deletedAt` is
  an allow-listed filter, so an unconditional exclusion would make
  `filter[deletedAt][null]=false` return nothing forever. The repository
  therefore drops its own `deleted_at is null` as soon as the parsed query
  carries a `deletedAt` filter. The rule generalises: a module-supplied
  `extraWhere` that shadows a filterable field must yield to that field.
- **`total` comes from a second query on the same executor**, not from a window
  function. The rows are fetched through Drizzle's relational API, which is what
  loads each account's roles in one round trip; a `count(*) over()` would mean
  hand-writing that join. The two statements run on whatever executor the
  repository is given, so a caller that needs them to agree exactly passes a
  transaction — and no caller in the first deliverable does, because an admin
  table showing a count one insert stale is not a correctness problem.

### Determinism

- Sort always appends `id asc` as a tiebreaker so pages are stable.
- `total` is included by default (offset pagination needs it for page counts). Endpoints with very large tables may switch to `total: null` + `hasMore` later — the `Pagination` type allows `total: number | null`.

### Future: cursor pagination

Cursor/keyset pagination (for feeds, infinite scroll) will be added as an alternative mode (`cursor=` / `meta.pagination.nextCursor`) under a future ADR; the envelope already leaves room.

## Consequences

- Every list endpoint is implemented the same way with ~10 lines of module-specific code (allow-lists + column map).
- Clients (admin tables) get a predictable query language.
- Allow-listing prevents sorting/filtering on non-indexed or sensitive columns.

## Alternatives considered

- `page`/`pageSize`: equivalent; `offset`/`limit` matches the requirement and maps directly to SQL.
- RSQL / OData `$filter` strings: powerful, but need a parser and are error-prone to hand-write in Postman.
- No `total`: cheaper, but admin UIs need page counts.
