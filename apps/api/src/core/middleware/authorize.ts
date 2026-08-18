import {
  SUPER_ADMIN_ROLE,
  type Population,
  type StaffRole,
  type UserRole,
} from "@repo/contracts";
import type { RequestHandler } from "express";

import { requirePrincipal } from "../auth/policies.js";
import { forbidden } from "../errors/index.js";

/**
 * Role authorization (ADR-0019 §2).
 *
 * Applied at the mount point of a resource router, so a new endpoint inherits
 * the guard from where it lives rather than from someone remembering to add
 * one:
 *
 * ```ts
 * router.use("/staff", authorize("admin"), createStaffRouter(c));
 * router.patch("/:id", authorize("admin"), controller.update);   // refine per route
 * ```
 *
 * It runs *after* `authenticate()` and reads only `ctx.principal`, which means
 * it needs no dependencies and is a plain exported handler rather than a
 * factory over a container.
 */

/** The roles each population can hold. */
interface RolesOf {
  readonly staff: StaffRole;
  readonly user: UserRole;
}

/**
 * Requires at least one of `allowed`.
 *
 * **Deny by default**: `authorize()` with no roles admits nobody but a
 * `super_admin`, so an empty list is a lock, not a hole (ADR-0019 §Rules).
 *
 * **`super_admin` bypasses every staff role check** — explicitly, on one line,
 * so the bypass is greppable from the guard, the seed and the "last super
 * admin" invariant (ADR-0017).
 *
 * The population is a type parameter with a `staff` default rather than
 * something inferred from the arguments: `authorize("customer")` on an admin
 * router is then a compile error, which is what ADR-0019 asks for. A user-side
 * guard states it — `authorize<"user">("customer")` — and v1 has none, because
 * `customer` is the only user role and authentication alone already implies it.
 */
export const authorize = <P extends Population = "staff">(
  ...allowed: readonly RolesOf[P][]
): RequestHandler => {
  const allowedRoles: readonly string[] = allowed;

  return (req, _res, next) => {
    const principal = requirePrincipal(req.ctx);

    if (
      principal.kind === "staff" &&
      principal.roles.includes(SUPER_ADMIN_ROLE)
    ) {
      next();

      return;
    }

    if (!principal.roles.some((role) => allowedRoles.includes(role))) {
      throw forbidden();
    }

    next();
  };
};
