# List queries

Every collection endpoint speaks one query language — `offset`, `limit`, `sort`, `filter[field][op]`, `q`, `count` — over a per-endpoint allow-list, and answers the page inside the list envelope with the query echoed in `meta`. The same string a browser holds in its address bar is the string the API accepts.

## Requirement: Pagination is bounded

`limit` defaults to `20` and may not exceed the endpoint's ceiling (never above `100`); `offset` defaults to `0` and may not exceed `10000`. Out-of-range values answer `400 VALIDATION_ERROR` through the ordinary validation path. Every page is ordered deterministically: the requested sort, then `id` ascending as the tiebreaker.
Records: [ADR-0014](../adr/0014-pagination-filtering-sorting.md), [ADR-0060](../adr/0060-list-endpoints-at-scale.md)
Proved by: `apps/api/test/list-query.int.test.ts`, `packages/contracts/src/__tests__/list-query.test.ts`, `apps/api/src/core/http/__tests__/list-query.test.ts`

### Scenario: Too deep

- **WHEN** a client sends `?offset=10001` or `?limit=101`
- **THEN** the answer is `400 VALIDATION_ERROR` naming the parameter

### Scenario: Ties

- **WHEN** several rows share the sorted value
- **THEN** their order is stable across pages and across requests

## Requirement: Sort and filter are allow-listed per endpoint

`sort` is a comma list of fields, `-` for descending; `filter[field]=v` means equality and `filter[field][op]=v` one of `in`, `gt`, `gte`, `lt`, `lte`, `like`, `null`. A field or operator the endpoint does not allow, a duplicate sort field, and an unknown top-level parameter each answer `400 VALIDATION_ERROR` naming the offender. `q` is accepted only where the endpoint is searchable.
Records: [ADR-0014](../adr/0014-pagination-filtering-sorting.md), [ADR-0011](../adr/0011-middleware-pipeline.md)
Proved by: `apps/api/test/list-query.int.test.ts`, `packages/contracts/src/__tests__/list-query.test.ts`

### Scenario: A filter the endpoint does not offer

- **WHEN** a client sends `filter[passwordHash]=x`
- **THEN** the answer is `400 VALIDATION_ERROR` listing the filterable fields

### Scenario: Literal brackets

- **WHEN** the query string carries `filter[status][in]=active,disabled` with unencoded brackets
- **THEN** it parses as the two-member `in` filter

### Scenario: A search where none is offered

- **WHEN** a client sends `q=term` to an endpoint that is not searchable
- **THEN** the answer is `400 VALIDATION_ERROR` at `q`

## Requirement: `count=false` skips the total

With `count=false` the repository runs no aggregate and `meta.pagination.total` is `null`; the items are the same page the counted request would return. The default is `true`.
Records: [ADR-0060](../adr/0060-list-endpoints-at-scale.md)
Proved by: `apps/api/test/list-query.int.test.ts`

### Scenario: Declining the count

- **WHEN** a client lists with `?count=false`
- **THEN** `meta.pagination.total` is `null` and `data` is unchanged from the counted request

## Requirement: Search and `like` reach the index on every column type

`q` matches case-insensitively as a contained term across the endpoint's searched columns, and `filter[email][like]=%pattern%` is the same comparison on one column; both are served by the trigram index whatever the column's type, because the comparison casts to `text`.
Records: [ADR-0060](../adr/0060-list-endpoints-at-scale.md)
Proved by: `apps/api/test/list-query.int.test.ts`, `apps/api/src/modules/users/__tests__/users.list-indexes.test.ts`, `apps/api/src/modules/staff/__tests__/staff.list-indexes.test.ts`

### Scenario: A partial address

- **WHEN** a client lists users with `q=ada`
- **THEN** every live account whose email or name contains `ada` in any case is on the page

## Requirement: `meta` echoes the query

`meta.sort` carries the parsed sort, `meta.filters` the applied filters keyed `field` or `field[op]`, and `meta.pagination` the offset, limit and total — so a client can rebuild its state from the response alone.
Records: [ADR-0012](../adr/0012-response-envelope.md), [ADR-0014](../adr/0014-pagination-filtering-sorting.md)
Proved by: `apps/api/test/list-query.int.test.ts`, `apps/api/test/envelope.int.test.ts`

### Scenario: The default sort

- **WHEN** a client sends no `sort`
- **THEN** `meta.sort` carries the endpoint's default rather than an empty list
