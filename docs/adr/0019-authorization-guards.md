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

**Amended 2026-08-18 (implementation step 9).** `assertOwnerOrRole` did **not**
ship, and the sentence above is what this amendment corrects.

`/user/profile` turned out not to be an ownership check at all. The three
endpoints carry no `:id`: `getProfile`, `updateProfile` and `changePassword`
read their subject from `ctx.principal` and take no identifier argument, so
there is no claimed owner to compare against a real one. Ownership is
_structural_ rather than asserted — a caller cannot name somebody else's
account, so the check has nothing to check and adding one would be a line that
can only ever pass.

The helper therefore waits for the first `:id`-addressed resource that has an
owner distinct from the caller — an order, a document, an upload — which is
where the `assertOwnerOrRole(ctx, resource.ownerId, ['admin'])` shape earns its
keep. Writing it now would mean an unused export and a test proving a tautology,
which is the same reason step 8 declined to leave an unused `rolesOf` behind
(ADR-0017, amended).

_A guarded segment answers an anonymous caller `401` even for a path that does
not exist._ `authenticate()` is mounted with `router.use()` above the resource
routers, and Express runs router-level middleware for every request that enters
the router, matched or not. So `GET /api/v1/admin/does-not-exist` without
credentials is `401`, not the `404 ROUTE_NOT_FOUND` that ADR-0013's table
implies and that a step-7 test asserted (step 8's plan note predicted the change
and scheduled it here).

This is kept rather than worked around, because it is level 1 of this ADR
applied consistently: the reason a wrong-population token gets `401` instead of
`403` is that the API must not reveal which paths exist to somebody not entitled
to know, and "no credentials at all" is not a stronger entitlement than "the
wrong population's credentials". The diagnostic is not lost, only earned — an
authenticated principal of the right population still gets `404
ROUTE_NOT_FOUND` for an unknown path, and the unguarded `/api/v1/public`
segment answers `404` to everyone. Restoring `404` for anonymous callers would
mean guarding each resource router individually and leaving the segment open,
which is precisely the arrangement rule 1 exists to prevent.

What the step _did_ add is the other half of the rule: `/api/v1/admin/users` is
the first router whose guard is not uniform. It mounts with
`authorize("admin", "manager")` — a manager may read the customer base — and its
three writing routes narrow back to `authorize("admin")`. Refinement composes in
that direction only: both guards run, so a route may narrow the mount's guard
and can never widen it.

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
