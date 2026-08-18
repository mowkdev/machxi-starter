# ADR-0019: Authorization guards (population + role)

- Status: accepted
- Date: 2026-08-17

## Context

After authentication (ADR-0018) we need consistent enforcement of _who may do what_: population at the segment level, roles at the router/route level, and occasionally resource ownership inside services (a user may edit only their own profile). Checks must be declarative where possible and testable.

## Decision

### Three levels

1. **Population** — enforced by `authenticate('staff' | 'user')` at router level (ADR-0015). A user token on `/admin/*` never reaches a role check: it fails population match with `401 UNAUTHENTICATED` (deliberately not 403, to avoid revealing route existence to the wrong population).

2. **Role** — `authorize(...roles)` middleware:

   ```ts
   export const authorize =
     (...allowed: Role[]) =>
     (req, _res, next) => {
       const p = req.ctx.principal;
       if (!p) throw unauthenticated();
       if (p.kind === "staff" && p.roles.includes("super_admin")) return next(); // super admin bypass
       if (!p.roles.some((r) => allowed.includes(r))) throw forbidden();
       next();
     };
   ```

   Applied at router mount (`r.use('/users', authorize('admin','manager'), usersRoutes)`) and refined per route where needed (`DELETE /users/:id` → `authorize('admin')`). Type-level: `authorize` is generic on population so passing a user role to an admin router is a compile error.

3. **Resource / business rules** — inside services, using `ctx.principal`, with helpers in `core/auth/policies.ts`:

   ```ts
   assertOwnerOrRole(ctx, resource.ownerId, ["admin"]); // throws forbidden()
   ```

   Examples: users editing their own profile; managers only seeing users in their region (future); refusing to disable the last super admin (ADR-0017).

### Rules

- Guards throw `AppError`s (ADR-0013); no inline `res.status(403)`.
- Roles come from the principal (JWT claims, ADR-0018), never re-read per request in v1.
- Every admin resource router declares an `authorize` at mount time — a router without one is flagged in review; an integration test enumerates admin routes and asserts a 401/403 for an unprivileged principal.
- Deny by default: no role listed = only `super_admin` passes.

**Amended 2026-08-18 (implementation step 8).** Two details of the shape above.

_The population is an explicit type parameter, not an inferred one._
`authorize` is declared `<P extends Population = "staff">(...allowed:
RolesOf[P][])`. `RolesOf[P]` is not an inference site, so `P` stays at its
default and `authorize("customer")` on an admin router is a compile error, which
is what this ADR asks for. A user-side guard states the population —
`authorize<"user">("customer")` — and v1 has none, because `customer` is the
only user role and authentication already implies it.

_`core/auth/policies.ts` ships with `requirePrincipal` and `requirePopulation`._
The guard and the services share them, so "there is no principal" and "the
principal is of the wrong population" answer `401` from one place. Both are
reachable only through a wiring mistake — a route mounted outside its guard —
and both still answer rather than crash, because a `500` would tell an anonymous
caller that the route exists and is broken. `assertOwnerOrRole`, the ownership
helper sketched above, lands with step 9's `/user/profile` endpoints, which are
the first resources that have an owner.

### Path to permissions

When permissions arrive, `authorize` gains an overload `authorize({ permissions: ['users:write'] })`; roles → permissions resolution happens at token issuance (claims) or via a cached lookup. Existing role-based calls keep working.

## Consequences

- Authorization is visible in the router files, close to the URL structure.
- Service-level policies keep business ownership rules where the data is.
- `super_admin` bypass simplifies the seed-and-test path; it is explicit and greppable.

## Alternatives considered

- CASL / casbin now: capable, but heavier than v1 needs; can wrap `authorize` later.
- Only service-level checks: no early rejection, easier to forget.
- Only route-level checks: cannot express ownership.
