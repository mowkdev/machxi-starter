import type { FederatedStartResource } from "@repo/contracts";
import type { Response } from "express";

import { validation } from "../../core/errors/index.js";
import { respond } from "../../core/http/index.js";
import type { ValidatedRequest } from "../../core/middleware/index.js";
import type { AuthCookies } from "./auth.cookies.js";
import { federatedHandoffInvalid } from "./auth.errors.js";
import type {
  FederatedCallbackOutcome,
  FederatedSignInService,
} from "./auth.federated.service.js";
import type { AuthService } from "./auth.service.js";
import type {
  federatedCallbackSchema,
  federatedExchangeSchema,
  federatedStartSchema,
} from "./auth.federated.schemas.js";
import { applyAuthTransport } from "./auth.transport.js";

/**
 * HTTP adapters for sign-in with Google (ADR-0072 §2, ADR-0009).
 *
 * Everything that is about HTTP rather than about identity lives here and in
 * nowhere else: the transaction cookie — written by the start, read and
 * cleared by the callback — the callback's redirect with its fragment, and the
 * exchange's transport. The services know none of it, exactly as
 * `createAuthService` has never known where a refresh token travels.
 */

/**
 * Where the customer app lands a sign-in (ADR-0072 §2, §4). One route for
 * every outcome; the fragment says which.
 */
export const FEDERATED_LANDING_PATH = "/auth/google";

export interface FederatedControllerDeps {
  readonly service: FederatedSignInService;
  /** The user population's auth service, for the exchange (a session is its aggregate). */
  readonly auth: Pick<AuthService, "exchangeFederatedHandoff">;
  /**
   * This deployment's cookie writers (ADR-0064 §1): the transaction cookie,
   * and the same session cookies login places, for the exchange.
   */
  readonly cookies: AuthCookies;
  /** `REFRESH_TOKEN_TTL` — the refresh cookie's `Max-Age`, as login sets it. */
  readonly refreshTtlSec: number;
  /** `CUSTOMER_APP_URL` (ADR-0071 §1) — the only place a callback may send a browser. */
  readonly customerAppUrl: string;
}

export const createFederatedController = ({
  service,
  auth,
  cookies,
  refreshTtlSec,
  customerAppUrl,
}: FederatedControllerDeps) => {
  /**
   * The landing URL with one fragment parameter. The origin is configuration
   * and the path a constant, so nothing a caller sends can choose where a
   * credential is delivered — the property ADR-0071 §2's templates keep by
   * taking the origins once.
   */
  const landing = (fragment: string): string =>
    `${customerAppUrl}${FEDERATED_LANDING_PATH}#${fragment}`;

  return {
    /**
     * `200 { authorizationUrl }` and the transaction cookie (ADR-0072 §2).
     *
     * A fresh cookie on every start, replacing any earlier one: the attempt
     * the person is about to make is the only one the callback should finish.
     */
    start: async (
      req: ValidatedRequest<typeof federatedStartSchema>,
      res: Response,
    ): Promise<void> => {
      // A JSON body or nothing (`D19.2`'s `security-reviewer`). ADR-0072 §2's
      // reason for a `POST` is that the customer app's request is forced
      // through a preflight; a cross-site form can post `text/plain`, which
      // no parser reads and the schema would accept as `{}`, overwriting a
      // victim's in-flight transaction and spending their start budget. A
      // form cannot send `application/json`, and a script elsewhere cannot
      // send it without the preflight CORS refuses.
      if (!req.is("application/json")) {
        throw validation("The start takes a JSON body", [
          {
            message: "Content-Type must be application/json",
            code: "content_type",
          },
        ]);
      }

      const started = await service.start(req.ctx, req.valid.body);

      cookies.setOidcCookie(
        res,
        started.transaction,
        service.transactionTtlSec,
      );

      respond.ok<FederatedStartResource>(res, {
        authorizationUrl: started.authorizationUrl,
      });
    },

    /**
     * `302` to the customer app, whatever happened (ADR-0072 §2).
     *
     * **The transaction is spent first and unconditionally**: it is good for
     * one callback, and one that was matched, refused or never there must not
     * be available to a second navigation. On a refusal the cookie is simply
     * cleared and the fragment is `#error=<code>` and nothing else. On a
     * sign-in the cookie's place is taken by the **handoff binding** — the
     * hash of the token in `#token=…` — so only this browser can exchange it
     * (amended at `D19.2`).
     */
    callback: async (
      req: ValidatedRequest<typeof federatedCallbackSchema>,
      res: Response,
    ): Promise<void> => {
      const transaction = cookies.readOidcCookie(req);

      let outcome: FederatedCallbackOutcome;

      try {
        outcome = await service.callback(req.ctx, {
          code: req.valid.query.code,
          state: req.valid.query.state,
          error: req.valid.query.error,
          transaction,
        });
      } catch (error) {
        // A real fault still spends the transaction before the error handler
        // answers it.
        cookies.clearOidcCookie(res);

        throw error;
      }

      if (!outcome.ok) {
        cookies.clearOidcCookie(res);
        respond.redirect(res, landing(`error=${outcome.code}`));

        return;
      }

      // The binding takes the transaction's place — one `Set-Cookie`, which
      // both ends the transaction and starts the handoff's sixty seconds.
      cookies.setOidcCookie(res, outcome.binding, service.handoffTtlSec);
      respond.redirect(
        res,
        landing(`token=${encodeURIComponent(outcome.token)}`),
      );
    },

    /**
     * `200` with login's body, on whichever transport the caller asked for —
     * `verify-email`'s answer, inherited whole (ADR-0072 §2, ADR-0071 §3) —
     * **and only in the browser the callback answered** (amended at `D19.2`,
     * on that step's `security-reviewer`).
     *
     * The token alone would be a bearer credential anybody could relay: run
     * the flow in one's own browser, lift `#token=` from the redirect, and send
     * somebody else to the landing route, which signs a browser with no
     * session into the relayer's account. The binding the callback left in
     * the transaction cookie is checked before anything is spent, and the
     * cookie is cleared either way; every refusal is the exchange's one `401`.
     */
    exchange: async (
      req: ValidatedRequest<typeof federatedExchangeSchema>,
      res: Response,
    ): Promise<void> => {
      const binding = cookies.readOidcCookie(req);

      cookies.clearOidcCookie(res);

      if (!(await service.bindsHandoff(binding, req.valid.body.token))) {
        req.ctx.logger.warn(
          { reason: binding === undefined ? "no binding" : "binding mismatch" },
          "federated exchange refused: not the browser the callback answered",
        );

        throw federatedHandoffInvalid();
      }

      const resource = await auth.exchangeFederatedHandoff(
        req.ctx,
        req.valid.body,
      );

      respond.ok(
        res,
        applyAuthTransport(req, res, resource, {
          cookies,
          population: "user",
          maxAgeSec: refreshTtlSec,
        }),
      );
    },
  } as const;
};

export type FederatedController = ReturnType<typeof createFederatedController>;
