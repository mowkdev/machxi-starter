# ADR-0012: Unified response envelope

- Status: accepted
- Date: 2026-08-17

## Context

Every client (admin SPA, web, mobile, Postman) should be able to handle any endpoint with one parser: one shape for a single resource, one for a list (with pagination metadata), one for errors. The shape must be enforced so a controller cannot accidentally emit an ad hoc body.

## Decision

### Shapes

**Single resource / object**

```json
{
  "success": true,
  "data": { "id": "…", "email": "…" },
  "meta": { "requestId": "…" }
}
```

**List**

```json
{
  "success": true,
  "data": [ { "id": "…" }, { "id": "…" } ],
  "meta": {
    "requestId": "…",
    "pagination": { "offset": 0, "limit": 20, "total": 143 },
    "sort": [{ "field": "createdAt", "direction": "desc" }],
    "filters": { "status": "active" }
  }
}
```

**Empty success** (e.g. logout, delete): `204 No Content` with no body. (`data: null` with 200 is used only when a body is required by the client, e.g. `POST` actions returning nothing but a request id.)

**Error** (ADR-0013)

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [ { "path": "email", "message": "Invalid email", "code": "invalid_string" } ]
  },
  "meta": { "requestId": "…" }
}
```

`success` is the discriminator; `data` and `error` are mutually exclusive; `meta.requestId` is always present.

### Enforcement — helpers, typed contracts, no raw `res.json` in controllers

```ts
// packages/contracts/src/envelope.ts   (shared types)
export interface Meta { requestId: string; pagination?: Pagination; sort?: SortSpec[]; filters?: Record<string, unknown> }
export interface SuccessEnvelope<T> { success: true;  data: T; meta: Meta }
export interface ListEnvelope<T>    { success: true;  data: T[]; meta: Meta & { pagination: Pagination } }
export interface ErrorEnvelope      { success: false; error: ApiError; meta: Meta }
export type Envelope<T> = SuccessEnvelope<T> | ListEnvelope<T> | ErrorEnvelope;

// apps/api/src/core/http/respond.ts
export const respond = {
  ok:      <T>(res, data: T, status = 200)               => res.status(status).json(envelope.ok(ctx(res), data)),
  created: <T>(res, data: T)                             => respond.ok(res, data, 201),
  list:    <T>(res, page: Page<T>)                       => res.status(200).json(envelope.list(ctx(res), page)),
  noContent: (res)                                       => res.status(204).end(),
};
```

- `Page<T> = { items: T[]; total: number; offset: number; limit: number; sort?; filters? }` is what services return for lists (ADR-0014). `respond.list` maps it into `data` + `meta.pagination`.
- `ctx(res)` above reads `res.req.ctx` (ADR-0010) for `requestId`; the helpers take only `res` so controllers stay one-liners.
- Controllers **only** use `respond.*`. An ESLint rule (`no-restricted-syntax` on `res.json` / `res.send` outside `core/http`) enforces it.
- Error responses are produced exclusively by the error middleware (ADR-0013); controllers throw.

### Status codes

| Case | Status | Helper |
|---|---|---|
| Read / update / action with result | 200 | `respond.ok` |
| Create | 201 | `respond.created` |
| Async accepted (later) | 202 | `respond.ok(res, data, 202)` |
| Delete / logout / no body | 204 | `respond.noContent` |
| Errors | per ADR-0013 | thrown |

### Resource shape rules

- Timestamps in ISO-8601 UTC strings; ids as UUID strings; money as integer minor units + currency (later).
- Never leak DB rows directly: every module has a `mapper` that produces the API resource (drops `passwordHash`, internal flags). Mappers are pure functions and unit-tested.
- Field names `camelCase`.
- Resources are stable contracts; breaking changes require a new API version (ADR-0015).

## Consequences

- Clients implement one envelope parser; SDK generation is straightforward.
- Controllers become 3–5 lines each.
- Adding response-wide metadata later (e.g. `meta.locale`, deprecation warnings) is a single change in `envelope.ts`.

## Alternatives considered

- Bare resources for success + envelope only for errors (GitHub style): simpler for singles, but lists then need a wrapper anyway, and clients handle two shapes.
- JSON:API / HAL: heavier than needed; hurts DX for simple CRUD.
- `res.locals` + a `res.json` override: implicit; the explicit helper + lint rule is easier to reason about.
