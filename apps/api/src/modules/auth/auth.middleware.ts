import type { Population } from "@repo/contracts";
import type { RequestHandler } from "express";

import type { Audit } from "../../core/audit/index.js";
import { unauthenticated } from "../../core/errors/index.js";
import {
  impersonationRefused,
  sessionRevoked,
  tokenInvalid,
} from "./auth.errors.js";
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
   * The session behind a verified token must still be live, must belong to the
   * principal the token names, in this population — and must agree with the
   * token about **who is acting**.
   *
   * A mismatch cannot be produced by a client — the signature covers every
   * claim compared here — so it would mean a session id had been reused across
   * rows, and the only safe answer is to treat the token as invalid.
   *
   * The actor comparison is `D13.5`'s, out of `security-reviewer`'s highest
   * finding, and it is what makes ADR-0057 §4's "the session row remains the
   * source of truth" a check rather than a claim. The whole exclusion list
   * (§5) and the whole audit attribution (ADR-0058) hang off one optional JWT
   * claim, and the row this function already holds is the authority for it: an
   * issue path that forgot `actorId` would otherwise downgrade an impersonated
   * session to an ordinary one — full takeover rights, the customer named as
   * the actor in the append-only table, and the gate green throughout. One
   * comparison on a row already in memory closes it, and the direction is
   * fail-closed: disagreement is a dead token, not a guess.
   */
  const assertLiveSession = async (
    sessionId: string,
    principalId: string,
    population: Population,
    actorId: string | undefined,
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
      session.principalId !== principalId ||
      (session.impersonatedByStaffId ?? undefined) !== actorId
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

      // One fact, read once, and consumed three times below. The spellings
      // cannot disagree today — the principal's spread already sits in the
      // non-staff branch — but a third population would make them diverge
      // silently, and what would diverge is who the logs say was here.
      const actorId = claims.pop === "user" ? claims.act?.sub : undefined;

      await assertLiveSession(claims.sid, claims.sub, population, actorId);

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
              // The RFC 8693 actor claim, and the reason it exists: the
              // exclusions (ADR-0057 §5), the audit trail's identity mapping
              // (ADR-0058) and the log lines all need "who is really here" on
              // every request, and this is what makes it free.
              //
              // Read from the token, as ADR-0057 §4 decides — and *checked*
              // against the session row by `assertLiveSession` above, so the
              // row is the authority and the claim is only how it travels
              // without a second lookup. A token whose actor disagrees with
              // its session never reaches this line.
              //
              // The staff branch takes it nowhere: a staff session is never
              // impersonated, so an `act` claim arriving on one is ignored
              // rather than honoured.
              ...(actorId === undefined ? {} : { impersonatedBy: actorId }),
            };

      // Re-bound, not replaced: every line below this point — including the
      // access line, which reads the principal off `req.ctx` at completion
      // time — carries who made the request (ADR-0010).
      //
      // Both identities where there are two (ADR-0057 §6): a support
      // operator's requests must be findable in the logs by the operator's id,
      // not only by the account they were served as.
      req.ctx.logger = req.ctx.logger.child({
        principalId: claims.sub,
        population,
        ...(actorId === undefined ? {} : { impersonatedBy: actorId }),
      });

      next();
    };
  };
};

export type Authenticate = ReturnType<typeof createAuthenticate>;

/**
 * `refuseImpersonated` — the exclusion list, as a named guard (ADR-0057 §5).
 *
 * ADR-0019's declarative style, and the reason it is a middleware rather than
 * a check inside three services: the list is a property of the *routes*, so a
 * reader of `auth.routes.ts` and `users.routes.ts` can see which operations an
 * impersonator may not perform without opening a service. A hidden button in
 * the client is not the control; this is.
 *
 * It is the last thing an impersonator's request meets before the controller,
 * so it refuses **before** anything is verified, hashed or written: a refused
 * `change-password` never reaches the argon2 pool.
 *
 * A factory over the audit writer because the refusal is a v1 audit write
 * point (ADR-0058 §v1 write points) — `impersonation.refused`, on the
 * **trail** discipline, because there is no succeeding operation to join
 * transactionally and a failed audit insert must not turn a `403` into a
 * `500`. It lives in the auth module rather than in `core/middleware` for the
 * reason `authenticate` does: it answers with this module's error factory, and
 * `core` must not import a module.
 */
export const createRefuseImpersonated = ({
  audit,
}: {
  readonly audit: Audit;
}): RequestHandler => {
  return (req, _res, next) => {
    const { principal } = req.ctx;

    // Only a customer principal can carry an actor at all (ADR-0057 §4), so a
    // staff mount of this guard is a no-op rather than a mistake.
    if (principal?.kind !== "user" || principal.impersonatedBy === undefined) {
      next();

      return;
    }

    audit.trail(req.ctx, {
      event: "impersonation.refused",
      // The route, and nothing off the body: the two refusals that carry one
      // carry passwords in it. `originalUrl` rather than `url`, which Express
      // has rewritten to the mount-relative path by the time a sub-router is
      // dispatching, and without the query string for the reason the access
      // log drops it (ADR-0005).
      data: {
        method: req.method,
        path: req.originalUrl.split("?")[0] ?? req.originalUrl,
      },
    });

    throw impersonationRefused();
  };
};
