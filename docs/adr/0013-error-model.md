# ADR-0013: Error model and HTTP status mapping

- Status: accepted
- Date: 2026-08-17

## Context

Services must express failures without knowing HTTP; the error middleware must map them consistently; clients need machine-readable codes (for i18n and UI branching); operators need stack traces in logs but never in responses; unexpected errors must not leak internals.

## Decision

### `AppError` — one error type, factory functions

There is exactly one error type, `AppError`, and no subclass hierarchy. `AppError` is a plain `Error` carrying data; everything else is a **factory function** that produces one. Code identifies errors by `code` (and `isAppError()`), never by class.

```ts
// apps/api/src/core/errors/app-error.ts
export interface AppErrorData {
  status: number;            // HTTP status
  code: ErrorCode;           // stable machine code (see below)
  message: string;
  details?: ErrorDetail[];   // field-level or structured extra info (safe to expose)
  expose?: boolean;          // message safe for clients? default true
  cause?: unknown;
}
export type AppError = Error & Readonly<AppErrorData> & { readonly [APP_ERROR]: true };

export const appError = (data: AppErrorData): AppError => { /* new Error(message) + Object.assign + brand */ };
export const isAppError = (e: unknown): e is AppError => typeof e === 'object' && e !== null && APP_ERROR in e;
```

Generic factories (one per status family), in `core/errors/errors.ts`:

```ts
export const validation      = (message = 'Request validation failed', details?: ErrorDetail[]) => appError({ status: 400, code: 'VALIDATION_ERROR', message, details });
export const unauthenticated = (message = 'Unauthenticated', code: ErrorCode = 'UNAUTHENTICATED') => appError({ status: 401, code, message });
export const forbidden       = (message = 'Forbidden', code: ErrorCode = 'FORBIDDEN')             => appError({ status: 403, code, message });
export const notFound        = (message = 'Not found', code: ErrorCode = 'NOT_FOUND')             => appError({ status: 404, code, message });
export const conflict        = (message = 'Conflict', code: ErrorCode = 'CONFLICT')               => appError({ status: 409, code, message });
export const rateLimited     = (retryAfterSec: number)                                            => appError({ status: 429, code: 'RATE_LIMITED', message: 'Too many requests', details: [{ code: 'retryAfter', message: String(retryAfterSec) }] });
export const internal       = (cause?: unknown)                                                   => appError({ status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error', expose: false, cause });
export const unavailable    = (details?: ErrorDetail[])                                           => appError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable', details });
```

Domain-specific errors are thin factories in the owning module (`modules/<m>/<m>.errors.ts`) that fix a more specific `code`, keeping the status:

```ts
export const invalidCredentials = () => unauthenticated('Invalid email or password', 'AUTH_INVALID_CREDENTIALS');
export const tokenExpired       = () => unauthenticated('Access token expired', 'AUTH_TOKEN_EXPIRED');
export const refreshReused      = () => unauthenticated('Refresh token reuse detected', 'AUTH_REFRESH_REUSED');
export const accountDisabled    = () => forbidden('Account is disabled', 'AUTH_ACCOUNT_DISABLED');
export const emailTaken         = () => conflict('Email already in use', 'USER_EMAIL_TAKEN');
```

Usage: `throw notFound('User not found')`; tests assert with `expect(isAppError(e) && e.code).toBe('NOT_FOUND')`.

### Error codes

- `SCREAMING_SNAKE_CASE`, namespaced by domain prefix for specific ones (`AUTH_`, `USER_`, `STAFF_`), generic ones unprefixed.
- The full union `ErrorCode` lives in `@repo/contracts` so clients can switch on it exhaustively and, later, map codes to localized messages. **Codes are the i18n key; `message` is a developer-facing English default.**

### Wire format (ADR-0012)

```json
{ "success": false,
  "error": { "code": "NOT_FOUND", "message": "User not found", "details": [] },
  "meta": { "requestId": "01J…" } }
```

`details` items: `{ path?: string; message: string; code?: string }` — used for validation (`path` = dotted field path) and for structured hints (e.g. `{ code: 'PASSWORD_TOO_WEAK', message: '…' }`).

### Error middleware mapping

| Thrown | Status | Body |
|---|---|---|
| `isAppError(err)` | `err.status` | `err.code`, `err.message` (or generic if `!expose`), `err.details` |
| `ZodError` | 400 | `VALIDATION_ERROR`, details from `issues` (`path.join('.')`, `message`, `code`) |
| JSON parse error (`entity.parse.failed`) | 400 | `MALFORMED_JSON` |
| Payload too large | 413 | `PAYLOAD_TOO_LARGE` |
| Postgres unique violation (`23505`) not caught by repo | 409 | `CONFLICT` |
| Anything else | 500 | `INTERNAL_ERROR`, message `"Internal server error"` |

- 5xx and unknown errors are logged at `error` with `err` (stack, cause) and `requestId`; 4xx at `warn` without stack.
- In `NODE_ENV=development` the 500 body additionally includes `error.debug: { name, message, stack }`; never in test/production.
- Repositories translate known DB errors into domain errors where the intent is clear (unique email → `emailTaken()`); the generic `23505 → CONFLICT` mapping is a safety net.
- `notFoundHandler` throws `notFound('Route not found', 'ROUTE_NOT_FOUND')`.

**Amended 2026-08-18 (step 7), two points about the middleware itself:**

- **The table above is not the whole body-parser story.** `entity.parse.failed`
  and `entity.too.large` are two of nine failure types; the rest
  (`entity.verify.failed`, `parameters.too.many`, `charset.unsupported`,
  `encoding.unsupported`, `stream.encoding.set`, `stream.not.readable`,
  `request.aborted`) are equally the client's doing, and any one left unmapped
  falls through to `INTERNAL_ERROR` — which lets an unauthenticated caller drive
  the server-error rate and, in development, get a stack trace back for a bad
  request. All nine map to a 4xx, and the wire message is **ours** in every case:
  the library's own text is not echoed, so the mapping cannot start leaking
  library internals if body-parser rewords an error.
- **The error handler must not be able to fail.** It reads `req.ctx`
  defensively and falls back to the container logger and a placeholder request
  id. The context middleware is second in the chain, so the window is narrow —
  but if anything above it throws, an unguarded read makes *this* handler throw,
  and Express's `finalhandler` answers with the raw stack. The one path that must
  never fail is the one that exists to stop failures from leaking.

### Rules

- Services throw `AppError`s created via factories; they never return `{ error }` objects and never define new error classes.
- Controllers do not `try/catch` except to translate third-party errors at the boundary.
- Never expose stack traces, SQL, or internal ids of other tenants/users in `message`/`details`.

## Consequences

- One place decides status codes; codes are stable and typed end-to-end.
- Ready for i18n: clients (or a future server-side catalog) render text from `code` + `details`.
- Every error response is correlatable to a log line via `meta.requestId`.

## Alternatives considered

- `http-errors` package: statuses only, no stable codes/details, not typed.
- RFC 7807 `application/problem+json`: good standard, but the project already commits to a single envelope; the `error` object mirrors problem-details fields (`code` ≈ `type`, `message` ≈ `title`) so a future adapter is trivial.
- Class hierarchy (`NotFoundError extends AppError`): idiomatic in OOP codebases, but `instanceof` checks are brittle across bundles and the project is functional by decision (ADR-0009); a single branded type + factories gives the same typing with less ceremony.
- Result/Either types instead of exceptions: more ceremony in TS; a single error type plus Express 5 forwarding is pragmatic.
