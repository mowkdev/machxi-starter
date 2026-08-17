# ADR-0015: Route segments (`public` / `user` / `admin`) and API versioning

- Status: accepted
- Date: 2026-08-17

## Context

Two populations (staff, users — ADR-0017) with separate authentication (ADR-0018) need separate route segments so that authentication is structural (whole segment guarded), URL intent is obvious, and per-segment policies (rate limits, CORS, docs) can differ. The API must also be versionable without breaking clients.

## Decision

### URL layout

```
/health/*                       liveness / readiness (ADR-0016), unversioned
/api/v1/public/*                no auth (optional user auth allowed per-route)
/api/v1/user/*                  requires user principal
/api/v1/admin/*                 requires staff principal
```

Authentication endpoints live inside their population's segment, but are the exception to the segment guard (they are the entry point):

```
POST /api/v1/user/auth/login          POST /api/v1/admin/auth/login
POST /api/v1/user/auth/refresh        POST /api/v1/admin/auth/refresh
POST /api/v1/user/auth/logout         POST /api/v1/admin/auth/logout
GET  /api/v1/user/auth/me             GET  /api/v1/admin/auth/me
POST /api/v1/public/auth/register     (user self-registration, if the project enables it)
```

Implementation:

```ts
// routes/user.router.ts
const r = Router();
r.use('/auth', userAuthRoutes(c));                 // login/refresh are public; me/logout apply authenticate inside
r.use(authenticate('user'));                        // everything below requires a user principal
r.use('/profile', userProfileRoutes(c));
// routes/admin.router.ts — same with authenticate('staff'), then authorize(...) per resource router
r.use('/staff', authorize('super_admin', 'admin'), staffRoutes(c));
r.use('/users', authorize('super_admin', 'admin', 'manager'), usersRoutes(c));
```

Resource paths inside segments are plural nouns; actions that don't map to CRUD use a verb sub-path (`POST /admin/users/:id/disable`).

Path params are validated (`z.string().uuid()`) — no leaking of DB errors for malformed ids.

Verb semantics: `GET` read, `POST` create or non-idempotent action, `PATCH` partial update (default for edits), `PUT` full replacement (rare, only when the resource is naturally replaced whole), `DELETE` delete/disable. Successful `DELETE` and actions without a result return `204` (ADR-0012).

### Versioning

- URL-path versioning (`/api/v1`). A version is bumped only for breaking changes to existing contracts (envelope, resource shape, semantics). Additive changes (new fields, new endpoints) don't bump.
- `routes/index.ts` mounts `v1Router`; a `v2` would mount alongside and share modules/services — versions live at the router/controller/mapper layer, not in services.
- Deprecation is signalled with `Deprecation` and `Sunset` headers when a version is scheduled for removal.

### Documentation

OpenAPI generation from zod schemas (`@asteasolutions/zod-to-openapi` or `zod-openapi`) is planned; not required for the first deliverable. The Postman collection (ADR-0021) is the interim contract.

## Consequences

- A route's auth requirement is visible in its URL and enforced at the router level.
- Admin and user features can evolve independently; the same domain service can serve both segments through different controllers/mappers (e.g. `users.service` used by `/admin/users` and `/user/profile`).
- Clear place for a future `/api/v1/partner/*` or `/api/v1/internal/*` segment.

## Alternatives considered

- Header or query versioning: less visible, awkward in Postman/browsers.
- Single `/api/v1/*` with per-route auth: easy to forget a guard.
- Separate API processes per population: operationally heavier; not needed at this stage.
