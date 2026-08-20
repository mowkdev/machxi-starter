import type { StaffRole } from "@repo/contracts";

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
export type ResourceName = "staff" | "users";

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
  "read" | "create" | "update" | "delete" | "setPassword" | "revokeSessions";

/**
 * `Partial` on purpose: **an action absent from a resource's block is allowed
 * to `super_admin` alone**, which is ADR-0019 §Rules' deny-by-default read from
 * the client side. Absence is a decision the type permits and {@link can}
 * answers, not an oversight it papers over.
 */
export type ResourcePolicy = Readonly<
  Record<
    ResourceName,
    Readonly<Partial<Record<ResourceAction, readonly StaffRole[]>>>
  >
>;

export const RESOURCE_POLICY = {
  /*
   * `apps/api/src/routes/admin.router.ts` — `authorize("admin")` at the mount,
   * and `staff.routes.ts` carries no per-route guard at all, deliberately: the
   * whole resource is `admin`, so every row here is that one mount.
   */
  staff: {
    read: ["admin"],
    create: ["admin"],
    update: ["admin"],
    delete: ["admin"],
    setPassword: ["admin"],
    revokeSessions: ["admin"],
  },
  /*
   * Mounted `authorize("admin", "manager")` — a manager may *read* the customer
   * base — and `users.routes.ts` narrows five writing routes back to
   * `authorize("admin")`: `POST /`, `PATCH /:id`, `POST /:id/sessions/revoke`,
   * `POST /:id/password`, `DELETE /:id`. Five, counted from the call sites.
   */
  users: {
    read: ["admin", "manager"],
    create: ["admin"],
    update: ["admin"],
    delete: ["admin"],
    setPassword: ["admin"],
    revokeSessions: ["admin"],
  },
  /*
   * **`/profile` is deliberately absent.** It mounts with no `authorize` at
   * all — every staff role may read its own account and change its own password
   * (ADR-0019 §3, ADR-0027) — so there is nothing for `can` to answer about it,
   * and an entry claiming otherwise would cost an operator their own profile
   * page. A resource with no role gate is not in this table.
   */
} as const satisfies ResourcePolicy;
