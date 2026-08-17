# ADR-0011: Middleware pipeline — logging, validation, auth, errors

- Status: accepted
- Date: 2026-08-17

## Context

Middleware order in Express determines correctness (a validator after the controller is useless; an error handler before the routes catches nothing). We need a fixed, documented order, a validation approach that yields typed inputs to controllers, and authentication that is applied per route segment.

## Decision

### Global order (in `createApp`)

```
1. pino-http                      access log + requestId            (ADR-0005)
2. contextMiddleware              builds req.ctx, enters ALS         (ADR-0010)
3. helmet                         security headers                   (ADR-0020)
4. cors                           allow-list from config             (ADR-0020)
5. express.json({ limit })        + urlencoded; strict JSON          (ADR-0003)
6. /health router                 no auth, no rate limit             (ADR-0016)
7. /api/v1 routers                per-segment auth + rate limits     (ADR-0015)
8. notFoundHandler                404 → envelope error               (ADR-0013)
9. errorHandler                   AppError/Zod/unknown → envelope    (ADR-0013)
```

Route-level (per router / per route):

```
[rateLimit?] → [authenticate(population)] → [authorize(roles)] → [validate(schemas)] → controller
```

### Validation — zod, per route, typed

```ts
// core/middleware/validate.ts
export const validate = <P, Q, B>(s: { params?: ZodType<P>; query?: ZodType<Q>; body?: ZodType<B> }) =>
  (req, _res, next) => {
    req.valid = {
      params: s.params ? s.params.parse(req.params) : undefined,
      query:  s.query  ? s.query.parse(req.query)   : undefined,
      body:   s.body   ? s.body.parse(req.body)     : undefined,
    };
    next();
  };
```

- Parsed values go to `req.valid.{params,query,body}` (typed via a generic `Request` alias, e.g. `ValidatedRequest<typeof schema>`); controllers never read raw `req.body`.
- Schemas live in `<module>.schemas.ts` and are also exported from `@repo/contracts` when clients need them (ADR-0002).
- Zod errors are caught by the error handler and rendered as `VALIDATION_ERROR` with a field-level `details` array (ADR-0013). Because Express 5 forwards thrown errors, `validate` doesn't need try/catch.
- Query schemas use `z.coerce` for numbers/booleans and `.strict()` where unknown keys should be rejected; body schemas default to `.strict()` to surface typos.

### Authentication middleware

- `authenticate('staff' | 'user')` — reads `Authorization: Bearer <jwt>`, verifies signature/expiry, checks that `payload.pop` matches the required population, loads the session row and confirms it is not revoked/expired, sets `ctx.principal`, re-binds logger (ADR-0018). Missing/invalid token → `401 UNAUTHENTICATED`.
- `authenticateOptional('user')` — same but tolerates absence (public routes that personalise when logged in).
- Applied at **router level** for the `user` and `admin` segments (ADR-0015), so a forgotten guard on a single route cannot expose it.

### Authorization middleware

- `authorize(...roles)` — requires `ctx.principal` and at least one matching role; `403 FORBIDDEN` otherwise (ADR-0019).

### Error handling

Single `errorHandler(err, req, res, next)` last in the chain (ADR-0013). `notFoundHandler` before it produces a consistent 404 for unknown paths (including under `/api/v1`).

### Async

Express 5 forwards rejected promises, so no `asyncHandler` wrapper. ESLint `@typescript-eslint/no-floating-promises` is on to catch un-awaited service calls in controllers.

## Consequences

- Controllers get typed, validated input; invalid input never reaches services.
- Auth is structural (per segment), not per-route opt-in.
- Order is documented in one place (`app.ts`) and asserted by an integration test that hits an unknown route, a validation failure and an unauthenticated route.

## Alternatives considered

- `express-validator`: string-based, no inferred types.
- `celebrate`/Joi: fine, but zod is used everywhere else.
- Per-route `authenticate` calls only: easy to forget; router-level default is safer.
