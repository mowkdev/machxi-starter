import type { Response } from "express";

import { respond } from "../../core/http/index.js";
import type { ValidatedRequest } from "../../core/middleware/index.js";
import type { ImpersonationService } from "./auth.impersonation.service.js";
import type {
  exchangeImpersonationSchema,
  mintImpersonationSchema,
} from "./auth.impersonation.schemas.js";
import { applyAuthTransport } from "./auth.transport.js";

/**
 * HTTP adapters for the two impersonation endpoints (ADR-0009, ADR-0057).
 *
 * One factory rather than two, unlike the profile pairs elsewhere, because the
 * usual reason to split does not apply: neither handler can be mounted on the
 * wrong segment by accident. `mint` needs a staff principal and refuses
 * without one, and `exchange` is registered by the auth router only when its
 * factory's population is `user` (ADR-0057 §3) — an admin-segment twin would
 * be a way to mint a staff session from a URL, and the guard against it is
 * that the route never exists there.
 */

export interface ImpersonationControllerDeps {
  readonly service: ImpersonationService;
  /**
   * `REFRESH_TOKEN_TTL` (ADR-0004) — the refresh cookie's `Max-Age`, the same
   * value login uses.
   *
   * Deliberately **not** `IMPERSONATION_SESSION_TTL`. The session's fixed end
   * is a server-side fact on the row (ADR-0057 §4); the cookie's `Max-Age` is
   * only how long a browser bothers to keep sending a value, and shortening it
   * would buy nothing while making a cookie that outlives its session look
   * like a bug. The session dies at its end either way, and the API is what
   * says so.
   */
  readonly refreshTtlSec: number;
}

export const createImpersonationController = ({
  service,
  refreshTtlSec,
}: ImpersonationControllerDeps) =>
  ({
    /**
     * `200` with a handoff token and **no `Set-Cookie` at all** (ADR-0057 §1).
     *
     * That absence is the security property, not an omission: the admin
     * segment's cookies are never written by this flow, which is what leaves
     * the minting staff member's own session untouched.
     */
    mint: async (
      req: ValidatedRequest<typeof mintImpersonationSchema>,
      res: Response,
    ): Promise<void> => {
      respond.ok(res, await service.mint(req.ctx, req.valid.params.id));
    },

    /**
     * `200` with the login-shaped `AuthResource`, on the user population's
     * transport (ADR-0057 §3).
     *
     * The same `applyAuthTransport` login goes through, with the same
     * population and the same TTL, so a customer app that opted into cookie
     * transport gets `__Secure-machxi.refresh` and `__Host-machxi.csrf.user`
     * exactly as it would from a sign-in — and a browser that already held a
     * real customer session has those cookies **overwritten** while its
     * session row is left alive, which is the operator's call recorded in
     * ADR-0057 §3.
     */
    exchange: async (
      req: ValidatedRequest<typeof exchangeImpersonationSchema>,
      res: Response,
    ): Promise<void> => {
      const resource = await service.exchange(req.ctx, req.valid.body);

      respond.ok(
        res,
        applyAuthTransport(req, res, resource, {
          population: "user",
          maxAgeSec: refreshTtlSec,
        }),
      );
    },
  }) as const;

export type ImpersonationController = ReturnType<
  typeof createImpersonationController
>;
