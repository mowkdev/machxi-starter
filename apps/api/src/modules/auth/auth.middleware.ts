import type { Population } from "@repo/contracts";
import type { RequestHandler } from "express";

import { unauthenticated } from "../../core/errors/index.js";
import { sessionRevoked, tokenInvalid } from "./auth.errors.js";
import type { SessionsRepository } from "./auth.repository.js";
import type { TokenService } from "./auth.tokens.js";

/**
 * `authenticate(population)` — the guard the `user` and `admin` segments mount
 * (ADR-0011 §Authentication middleware, ADR-0018 §Authenticated request).
 *
 * It is a factory over the token service and the sessions repository because
 * it does two things a stateless check cannot: it pins the token to a
 * population, and it asks the database whether the session behind it is still
 * alive. That second lookup is one primary-key probe per authenticated
 * request, accepted deliberately so that logout and admin revocation take
 * effect immediately instead of at the next token expiry (ADR-0018).
 *
 * It lives in the auth module rather than in `core/middleware` because it
 * depends on both — `core` must not import a module, or the layering stops
 * being a direction.
 */

const BEARER_PREFIX = "bearer ";

/**
 * Extracts the token from `Authorization: Bearer <token>`.
 *
 * @returns the token, `null` when the header is absent (nobody presented
 *   credentials), or `undefined` when it is present but not a usable bearer
 *   token (somebody presented the wrong thing). That distinction is the
 *   difference between `UNAUTHENTICATED` and `AUTH_TOKEN_INVALID` (ADR-0013).
 */
export const readBearerToken = (
  header: string | undefined,
): string | null | undefined => {
  if (header === undefined || header.trim() === "") return null;

  if (!header.toLowerCase().startsWith(BEARER_PREFIX)) return undefined;

  const token = header.slice(BEARER_PREFIX.length).trim();

  return token === "" ? undefined : token;
};

export interface AuthenticateDeps {
  readonly tokens: TokenService;
  readonly sessions: SessionsRepository;
  readonly now?: () => Date;
}

export const createAuthenticate = ({
  tokens,
  sessions,
  now = () => new Date(),
}: AuthenticateDeps) => {
  /**
   * The session behind a verified token must still be live and must belong to
   * the principal the token names, in this population.
   *
   * A mismatch cannot be produced by a client — the signature covers both
   * claims — so it would mean a session id had been reused across rows, and
   * the only safe answer is to treat the token as invalid.
   */
  const assertLiveSession = async (
    sessionId: string,
    principalId: string,
    population: Population,
  ): Promise<void> => {
    const session = await sessions.findById(sessionId);
    const at = now();

    if (
      session === undefined ||
      session.revokedAt !== null ||
      session.refreshTokenExpiresAt.getTime() <= at.getTime()
    ) {
      throw sessionRevoked();
    }

    if (
      session.principalType !== population ||
      session.principalId !== principalId
    ) {
      throw tokenInvalid();
    }
  };

  return (population: Population): RequestHandler => {
    return async (req, _res, next) => {
      const presented = readBearerToken(req.get("authorization"));

      if (presented === null) throw unauthenticated();
      if (presented === undefined) throw tokenInvalid();

      // Signature, `exp`, `iss` and the population's `aud`. A token minted for
      // the other segment fails inside `jose`, before any claim of ours is
      // read.
      //
      // The literal argument in each branch is what makes `claims` a
      // discriminated union on `pop`, so the principal below is built without
      // a cast: `verify` is generic on the population, and its `roles` are
      // narrowed to that population's role type.
      const claims =
        population === "staff"
          ? await tokens.verify(presented, "staff")
          : await tokens.verify(presented, "user");

      await assertLiveSession(claims.sid, claims.sub, population);

      req.ctx.principal =
        claims.pop === "staff"
          ? {
              kind: "staff",
              id: claims.sub,
              roles: claims.roles,
              sessionId: claims.sid,
            }
          : {
              kind: "user",
              id: claims.sub,
              roles: claims.roles,
              sessionId: claims.sid,
            };

      // Re-bound, not replaced: every line below this point — including the
      // access line, which reads the principal off `req.ctx` at completion
      // time — carries who made the request (ADR-0010).
      req.ctx.logger = req.ctx.logger.child({
        principalId: claims.sub,
        population,
      });

      next();
    };
  };
};

export type Authenticate = ReturnType<typeof createAuthenticate>;
