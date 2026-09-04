# Envelope and errors

Every response of the API has one of three shapes, every failure carries a stable machine code, and every response can be matched to a log line by its request id.

## Requirement: A success carries `data` and `meta.requestId`

A `2xx` response with a body is `{ data, meta }`, where `meta.requestId` is the id the request was logged under, and the same id is echoed in the `X-Request-Id` header.
Records: [ADR-0012](../adr/0012-response-envelope.md), [ADR-0010](../adr/0010-request-context.md)
Proved by: `apps/api/test/envelope.int.test.ts`, `apps/api/src/core/http/__tests__/envelope.test.ts`

### Scenario: A single resource

- **WHEN** a client reads one resource it may read
- **THEN** the body is `{ data: <resource>, meta: { requestId } }` and `X-Request-Id` equals `meta.requestId`

### Scenario: A client supplies the request id

- **WHEN** a request carries a well-formed `X-Request-Id`
- **THEN** the response and its log line carry that id rather than a generated one

## Requirement: A list carries pagination, sort and filters in `meta`

A collection response is `{ data: [...], meta: { requestId, pagination: { offset, limit, total }, sort, filters } }`, echoing the query the page was built from so a client can restore its state from the response alone. `total` is `null` when the client declined the count.
Records: [ADR-0012](../adr/0012-response-envelope.md), [ADR-0014](../adr/0014-pagination-filtering-sorting.md), [ADR-0060](../adr/0060-list-endpoints-at-scale.md)
Proved by: `apps/api/test/list-query.int.test.ts`, `apps/api/test/envelope.int.test.ts`

### Scenario: A page

- **WHEN** a client lists a collection with `?limit=2&sort=-createdAt`
- **THEN** `data` holds at most two items, `meta.pagination.limit` is `2`, `meta.sort` is `[{ field: "createdAt", direction: "desc" }]` and `meta.pagination.total` is the count of every row the filters admit

## Requirement: A failure is one envelope with a code

Every error response is `{ error: { code, message, details? }, meta: { requestId } }`. `code` is the contract a client branches on; `message` is developer-facing English a client never renders; `details` carries structured hints. A `debug` member appears only under `NODE_ENV=development`.
Records: [ADR-0013](../adr/0013-error-model.md), [ADR-0012](../adr/0012-response-envelope.md)
Proved by: `apps/api/test/envelope.int.test.ts`, `apps/api/src/core/errors/__tests__/errors.test.ts`, `packages/contracts/src/__tests__/errors.test.ts`

### Scenario: The status follows the code

- **WHEN** any handler fails
- **THEN** the status is the one the code's table assigns — `VALIDATION_ERROR` `400`, `UNAUTHENTICATED` `401`, `FORBIDDEN` `403`, `NOT_FOUND` `404`, `CONFLICT` `409`, `RATE_LIMITED` `429`, `INTERNAL_ERROR` `500`, `SERVICE_UNAVAILABLE` `503` — and never a bare status with an ad hoc body

### Scenario: An unexpected failure says nothing

- **WHEN** a handler throws something that is not an application error
- **THEN** the answer is `500 INTERNAL_ERROR` with a generic message, no stack and no internals, and the failure is reported through the error-reporting seam

## Requirement: Validation failures name the field

A request whose params, query or body fails its schema answers `400 VALIDATION_ERROR` with one `details` entry per rejected field, carrying the dotted `path`, the message and the issue code. Bodies are strict: an unknown key is a rejected field, not an ignored one.
Records: [ADR-0011](../adr/0011-middleware-pipeline.md), [ADR-0013](../adr/0013-error-model.md)
Proved by: `apps/api/src/core/middleware/__tests__/validate.test.ts`, `apps/api/test/envelope.int.test.ts`

### Scenario: A malformed body

- **WHEN** a client sends a body that is not JSON
- **THEN** the answer is `400 MALFORMED_JSON`

### Scenario: An unknown key

- **WHEN** a client sends a valid body with one key the schema does not declare
- **THEN** the answer is `400 VALIDATION_ERROR` and `details` names that key

### Scenario: An oversized body

- **WHEN** a client sends a body larger than the configured JSON limit
- **THEN** the answer is `413 PAYLOAD_TOO_LARGE`

## Requirement: An unknown route is `404` only where the caller is entitled to know

Under `/api/v1/public`, and for an authenticated principal of the right population under `/api/v1/{user,admin}`, an unmatched path answers `404 ROUTE_NOT_FOUND`. Without credentials, an unmatched path under a guarded segment answers `401`, so the existence of admin paths is not disclosed.
Records: [ADR-0019](../adr/0019-authorization-guards.md), [ADR-0013](../adr/0013-error-model.md), [ADR-0015](../adr/0015-route-segments-and-versioning.md)
Proved by: `apps/api/test/auth-segments.int.test.ts`, `apps/api/test/envelope.int.test.ts`

### Scenario: Anonymous, guarded segment

- **WHEN** a request with no `Authorization` header reaches `/api/v1/admin/does-not-exist`
- **THEN** the answer is `401 UNAUTHENTICATED`, not `404`

### Scenario: Authenticated, right population

- **WHEN** a staff principal requests `/api/v1/admin/does-not-exist`
- **THEN** the answer is `404 ROUTE_NOT_FOUND`
