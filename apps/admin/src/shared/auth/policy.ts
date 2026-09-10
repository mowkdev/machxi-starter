import type { ResourcePolicy as ResourcePolicyShape } from "@repo/app-services";

/**
 * The client's copy of the API's mount guards (ADR-0042).
 *
 * **This is a transcription, not a design.** Every entry below is read off an
 * `authorize(` call in `apps/api` — the segment router's mounts and each
 * resource router's per-route refinements — and off nothing else, this ADR's
 * own prose included. That rule exists because the prose is demonstrably the
 * unreliable copy: `admin.router.ts`'s comment once said the users router
 * narrows "four" writing routes and ADR-0019's D1.9 amendment says "three",
 * where `users.routes.ts` in fact narrows five. `__tests__/policy.test.ts`
 * pins this table against that transcription so the copy cannot drift
 * silently — it cannot detect a change on the other side of the wire, and
 * claiming otherwise would be the mitigation lying.
 *
 * **The table is data, for the reason ADR-0035 keeps functions out of config**:
 * it can be diffed against the routers it mirrors, snapshotted, and read whole
 * by a reviewer in one screenful. A `canDeleteStaff = (p) => …` per rule is a
 * vocabulary with no bound and no fixture.
 *
 * **It is never a security control** (ADR-0042 §It is never a security
 * control). Removing it, or making it answer `true` for everything, must
 * change nothing about which requests the API accepts — the client hiding
 * something is a courtesy, and the enforcement stays in ADR-0019's guards and
 * in the services below them.
 *
 * **No entry here may encode anything whose existence is itself secret.** The
 * whole table ships in the bundle and is readable by anyone who can load
 * `/login`, which is acceptable for resource and role names already in
 * `@repo/contracts` and would not be for a resource that must not be known to
 * exist.
 */

/** A resource this app draws affordances for. Keyed by the router's own path. */
export type ResourceName = "staff" | "users" | "organizations";

/**
 * What an operator may be asked to do to one.
 *
 * **The names are the endpoints', not a new vocabulary.** `setPassword` and
 * `revokeSessions` are the sub-resources ADR-0027 and the routers already call
 * by those names; `read` / `create` / `update` / `delete` are the controller
 * functions. Inventing names here would create a second naming system beside
 * the one the routers use, which is the whole objection to permission strings.
 */
export type ResourceAction =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "setPassword"
  | "revokeSessions"
  /**
   * `POST /admin/{staff,users}/:id/email` (`D18.10`, ADR-0071 §7) — named for
   * the route like the five above it.
   *
   * **The first action both resources grant to `super_admin` alone**, and the
   * first row here that names that role at all. It is written out rather than
   * left absent — which `ResourcePolicy`'s `Partial` says means the same thing
   * — because absence is how this table records "no such route", and there are
   * two such routes. A reader comparing the table with the routers must be
   * able to see that they were transcribed, not overlooked.
   */
  | "changeEmail"
  /**
   * `POST /admin/staff/:id/onboarding/resend` (`D18.11`, ADR-0071 §8) — named
   * for the route like the six above it.
   *
   * **`staff` alone**, and `users` has no key at all: there is no such route
   * under `/admin/users`, because a customer's address is proven by a link
   * they follow rather than asserted by an invitation an operator sends
   * (ADR-0071 §3). That absence is the `Partial` describing the API, exactly
   * as `impersonate`'s is in the other direction.
   *
   * Written out here even though nothing calls `can()` for it: this table is
   * a transcription of the routers, `setPassword` and `revokeSessions` are in
   * it on the same terms, and a route missing from it reads as "no such
   * route" to the next person comparing the two.
   */
  | "resendOnboarding"
  /**
   * `POST /admin/users/:id/impersonate` (`D13.8`, ADR-0057 §1/§7) — named for
   * the route like the five above it.
   *
   * **The first action no resource row grants uniformly**, and the first live
   * case for the `Partial` in `ResourcePolicy`: `staff` has no such route at
   * all — the mint is `/admin/users/:id` only, and staff impersonating staff is
   * a loose end ADR-0057 explicitly does not take — so `staff` has no
   * `impersonate` key, which is deny-by-default describing the API rather than
   * a hole in a transcription.
   */
  | "impersonate";

/**
 * This table's shape, from `@repo/app-services` since `D9.6`.
 *
 * The `Partial` in it is on purpose and is the package's to explain: **an
 * action absent from a resource's block is allowed to `super_admin` alone**,
 * which is ADR-0019 §Rules' deny-by-default read from the client side. What
 * stays here is the *instance* — the rows below, which are a transcription of
 * this API's `authorize(` calls and belong to no other deployment.
 */
export type ResourcePolicy = ResourcePolicyShape<ResourceName, ResourceAction>;

export const RESOURCE_POLICY = {
  /*
   * `apps/api/src/routes/admin.router.ts` — `authorize("admin")` at the mount,
   * and `staff.routes.ts` carries exactly one per-route guard: `POST /:id/email`
   * narrows to `super_admin` (`D18.10`). Every other row here is that one
   * mount.
   */
  staff: {
    read: ["admin"],
    create: ["admin"],
    update: ["admin"],
    delete: ["admin"],
    setPassword: ["admin"],
    revokeSessions: ["admin"],
    /*
     * The one route in `staff.routes.ts` that carries an `authorize(` of its
     * own (ADR-0071 §7): `POST /:id/email`, narrowing the mount to
     * `super_admin`. Gated rather than shown-and-refused, unlike the
     * containment controls beside it — nothing about an incident is made worse
     * by an operator not seeing a control they may never use, and this one is
     * not reached for mid-incident (ADR-0042 §Containment controls).
     */
    changeEmail: ["super_admin"],
    /*
     * `POST /:id/onboarding/resend` (ADR-0071 §8) — the mount's own `admin`,
     * with no per-route `authorize`: creating the invited row is an admin's
     * right, so re-sending the message it already sent cannot be a higher bar.
     */
    resendOnboarding: ["admin"],
  },
  /*
   * Mounted `authorize("admin", "manager")` — a manager may *read* the customer
   * base — and `users.routes.ts` narrows six writing routes back to
   * `authorize("admin")`: `POST /`, `PATCH /:id`, `POST /:id/sessions/revoke`,
   * `POST /:id/password`, `POST /:id/impersonate`, `DELETE /:id`. Six, counted
   * from the call sites — five until `D13.4` added the mint. A seventh call,
   * `POST /:id/email`, narrows further to `authorize("super_admin")` (`D18.10`)
   * and is the `changeEmail` row below.
   */
  users: {
    read: ["admin", "manager"],
    create: ["admin"],
    update: ["admin"],
    delete: ["admin"],
    setPassword: ["admin"],
    revokeSessions: ["admin"],
    /*
     * ADR-0057 §1: `admin` only, never `manager` — reading the customer base is
     * a manager's job and becoming a customer is not. `super_admin` passes on
     * `can`'s one bypass line, as it does at the guard.
     *
     * **Gated rather than shown-and-refused, which the other five writes are
     * not uniformly** (ADR-0042 §Containment controls): reset password and sign
     * out everywhere stay visible to a manager because they are what somebody
     * reaches for *during* an incident, and a hidden control is a silent
     * absence. Impersonation is the opposite — it is the highest-privilege
     * affordance in this app, and nothing about an incident is made worse by
     * its absence.
     *
     * A third reason was written here and struck: that an offered mint would
     * spend one of §1's per-actor budget for a `403`. It would not. The
     * limiter mounts **after** `authorize` precisely so that a refused
     * `manager` spends nothing (ADR-0057 §1, amended `D13.4`) — that budget
     * bounds the operators who *can* mint.
     */
    impersonate: ["admin"],
    /* `POST /:id/email` (ADR-0071 §7) — the staff row's twin, same reasoning. */
    changeEmail: ["super_admin"],
  },
  /*
   * Mounted `authorize("admin", "manager")` — a manager may *read* the tenant
   * base, the users resource's shape exactly (ADR-0067 §3) — and
   * `organizations.routes.ts` narrows six writing routes back to
   * `authorize("admin")`: `POST /`, `PATCH /:id` and `DELETE /:id` on the
   * resource, and `POST`, `PATCH /:userId` and `DELETE /:userId` on the
   * memberships sub-resource. Six, counted from the call sites — a `grep -c`
   * over that file says seven, and the seventh is its own header prose.
   *
   * **The sub-resource shares this row rather than having one of its own.**
   * Its four routes carry the same guard as the resource's writes, so a
   * `memberships` entry would be four more lines saying `["admin"]` a second
   * time — and a second place for the transcription to drift from the router
   * it is transcribed from. The members section reads `update` for its three
   * writes, which is what the router says about them.
   */
  organizations: {
    read: ["admin", "manager"],
    create: ["admin"],
    update: ["admin"],
    delete: ["admin"],
  },
  /*
   * **`/profile` is deliberately absent.** It mounts with no `authorize` at
   * all — every staff role may read its own account and change its own password
   * (ADR-0019 §3, ADR-0027) — so there is nothing for `can` to answer about it,
   * and an entry claiming otherwise would cost an operator their own profile
   * page. A resource with no role gate is not in this table.
   */
} as const satisfies ResourcePolicy;
