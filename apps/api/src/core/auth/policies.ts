import type { Population } from "@repo/contracts";

import type { Principal, RequestContext } from "../context/index.js";
import { unauthenticated } from "../errors/index.js";

/**
 * Policy helpers shared by guards and services (ADR-0019 §Resource / business
 * rules).
 *
 * They read `ctx.principal` and throw an `AppError`; they never look at a
 * request or write a response, so a service can apply the same rule a router
 * applies and a unit test can check it with a plain context object.
 *
 * `assertOwnerOrRole` — the ownership rule ADR-0019 sketches — lands with
 * step 9's `/user/profile` endpoints, which are the first resources that have
 * an owner.
 */

/**
 * The authenticated principal.
 *
 * Every caller sits behind `authenticate()`, so a `null` here is a wiring
 * mistake — a route mounted outside its guard — not a runtime condition. It
 * still answers `401` rather than crashing: the correct response to "we do not
 * know who this is" is the same either way, and a 500 would tell an anonymous
 * caller that the route exists and is broken.
 */
export const requirePrincipal = (ctx: RequestContext): Principal => {
  if (ctx.principal === null) throw unauthenticated();

  return ctx.principal;
};

/** Narrows the principal union to one population, without a cast. */
const isPopulation = <P extends Population>(
  principal: Principal,
  population: P,
): principal is Extract<Principal, { kind: P }> =>
  principal.kind === population;

/**
 * The authenticated principal of one population.
 *
 * A staff principal reaching a user-segment service (or the reverse) can only
 * come from a router mounted with the wrong guard. It is answered as an
 * invalid token, never as `403`: ADR-0019 fixes the status at 401 so the wrong
 * population cannot use the difference to probe for route existence.
 *
 * The return type is the *narrowed* member, not the union, which is what lets
 * a staff-side service read `principal.roles` as `StaffRole[]` — needed the
 * moment a service has a rule about a specific role, as step 9's
 * "only a super admin may grant `super_admin`" does.
 */
export const requirePopulation = <P extends Population>(
  ctx: RequestContext,
  population: P,
): Extract<Principal, { kind: P }> => {
  const principal = requirePrincipal(ctx);

  if (!isPopulation(principal, population)) throw unauthenticated();

  return principal;
};
