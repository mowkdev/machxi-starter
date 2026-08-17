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
// core/http/list-query.ts
export const listQuerySchema = (opts: { sortable: readonly string[]; filterable: FilterSpec; maxLimit?: number; defaultSort: string }) =>
  z.object({ offset, limit, sort, filter, q }) // returns a zod schema producing ListQuery

export interface ListQuery {
  offset: number; limit: number;
  sort: { field: string; direction: 'asc' | 'desc' }[];
  filters: Filter[];        // { field, op, value }
  q?: string;
}
export interface Page<T> { items: T[]; total: number; offset: number; limit: number; sort: SortSpec[]; filters: Record<string, unknown> }
```

- Each module declares its allow-lists once in `<module>.schemas.ts` (`sortable: ['createdAt','email','status'] as const`) and derives its query schema with `listQuerySchema`. Unknown sort/filter fields → `VALIDATION_ERROR`.
- Repositories translate `ListQuery` to Drizzle with a shared helper `applyListQuery(qb, query, columnMap)` (maps API field → column, applies `where`, `orderBy`, `limit/offset`) and run `count(*)` for `total` in the same transaction (or a single query with a window function `count(*) over()` — implementation detail, helper hides it).
- Services return `Page<T>`; controllers call `respond.list(res, page)` (ADR-0012), which emits `meta.pagination = { offset, limit, total }`, `meta.sort`, `meta.filters` so the client can render state without re-parsing its own query.

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
