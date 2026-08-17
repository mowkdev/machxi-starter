# ADR-0010: Request context object and propagation

- Status: accepted
- Date: 2026-08-17

## Context

Controllers and services need per-request data — the authenticated principal, request id, a correlated logger, locale (later) — without passing `req` into services (ADR-0009 forbids that) and without polluting every function signature. It must also be reachable from deep call sites (repositories logging, audit hooks) and from code that runs outside Express (seeders, jobs) with a synthetic context.

## Decision

### Shape

```ts
// apps/api/src/core/context/request-context.ts
export interface RequestContext {
  requestId: string;
  startedAt: number;                 // hrtime ms
  logger: Logger;                    // child logger bound with requestId (+ principal after auth)
  principal: Principal | null;       // set by auth middleware (ADR-0018)
  locale: string;                    // 'en' default; from Accept-Language later (i18n ADR)
  ip: string | undefined;
  userAgent: string | undefined;
}

export type Principal =
  | { kind: 'staff'; id: string; roles: StaffRole[]; sessionId: string }
  | { kind: 'user';  id: string; roles: UserRole[];  sessionId: string };
```

`principal.kind` is the population discriminator (ADR-0017); `roles` are loaded at authentication time so guards (ADR-0019) need no extra query.

### Storage and access

Two complementary mechanisms:

1. **`req.ctx`** — a `contextMiddleware` (first after `pino-http`) creates the context and attaches it to the request. Express type augmentation:

   ```ts
   declare global { namespace Express { interface Request { ctx: RequestContext } } }
   ```

   Controllers read `req.ctx` and pass it as the **first argument** to service methods: `svc.changePassword(ctx, dto)`. Passing `ctx` explicitly keeps services pure functions of their inputs and trivially testable.

2. **`AsyncLocalStorage`** — the same middleware runs the rest of the chain inside `contextStorage.run(ctx, next)`. `getContext()` returns the current context (or throws) for cross-cutting code that must not take `ctx` as a parameter (e.g. a shared repository helper stamping `updatedBy`, audit logger, error handler). Services **should** use the explicit `ctx` param; `getContext()` is for infrastructure.

### Rules

- `principal` is `null` until the auth middleware sets it; guards enforce presence (ADR-0019).
- After auth, the middleware re-binds `ctx.logger = ctx.logger.child({ principalId, population })`.
- Never store request bodies or arbitrary data on the context; it is a fixed, typed structure. Feature-specific state goes in service arguments.
- Non-HTTP entry points (seeds, CLI, jobs) build a context with `createSystemContext(name)` (`principal: { kind: 'system' }` is deliberately **not** a Principal variant — system code passes `null` principal and services that require one will refuse, which is the desired safety default).

### Response correlation

The request id is echoed as `X-Request-Id` and included in every error envelope (`meta.requestId`, ADR-0013) so a Postman/user report can be matched to a log line.

## Consequences

- Services receive everything they need in one typed object; adding `locale`/`tenantId` later is a one-place change.
- `AsyncLocalStorage` gives correlation for free in infrastructure code without threading.
- Slight discipline needed to avoid reaching for `getContext()` from services (lint rule: forbid importing `getContext` under `modules/**/*.service.ts`).

## Alternatives considered

- Only `req.ctx`: works, but forces `ctx` through every infra utility signature.
- Only `AsyncLocalStorage`: hides a dependency, makes unit tests need a storage harness.
- Setting `req.user` (Passport style): untyped, mixes populations, no place for logger/requestId.
