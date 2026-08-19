import type {
  LoginBody,
  Population,
  PrincipalResource,
  RegisterBody,
} from "@repo/contracts";
import type { PasswordHasher } from "@repo/crypto";
import { randomToken, sha256Base64url } from "@repo/crypto";
import type { DbExecutor } from "@repo/db";

import { requirePopulation } from "../../core/auth/policies.js";
import type { RequestContext } from "../../core/context/index.js";
import { internal } from "../../core/errors/index.js";
import {
  accountDisabled,
  invalidCredentials,
  invalidRefreshToken,
  refreshReused,
  registrationConflict,
  sessionRevoked,
} from "./auth.errors.js";
import type { HashLimiter } from "./auth.hash-limiter.js";
import { toAuthResource, type IssuedAuthResource } from "./auth.mapper.js";
import type { SessionsRepository } from "./auth.repository.js";
import type { TokenService } from "./auth.tokens.js";
import type { PrincipalAdapter, PrincipalRecord } from "./auth.types.js";

/**
 * The authentication flows of ADR-0018, written once for both populations.
 *
 * What makes one implementation serve `staff` and `users` is the
 * `PrincipalAdapter` (ADR-0017): everything below is expressed in terms of a
 * `PrincipalRecord` and a session row, and never in terms of a table. The
 * container instantiates it twice, and the two instances share no state — only
 * code.
 *
 * `now` and `newRefreshToken` are injected (ADR-0018 §Testability) so expiry,
 * the rotation grace window and reuse detection can be unit-tested at whatever
 * instant the test chooses, without sleeping and without stubbing globals.
 */

/** Values written into `sessions.revoked_reason`, for the audit trail. */
export const REVOKE_REASONS = {
  logout: "logout",
  logoutAll: "logout_all",
  refreshReuse: "refresh_reuse",
  accountDisabled: "account_disabled",
  principalMissing: "principal_missing",
  /** `POST /api/v1/admin/{staff,users}/:id/sessions/revoke` (step 9). */
  adminRevoke: "admin_revoke",
  /** `POST /api/v1/{admin,user}/profile/change-password` (step 9, D2.3). */
  passwordChanged: "password_changed",
  /**
   * `POST /api/v1/admin/{staff,users}/:id/password` (D2.3).
   *
   * Distinct from `passwordChanged`, and the distinction is the point: the
   * audit trail has to tell "the holder changed it" apart from "somebody else
   * changed it for them" (ADR-0027 §Decision rule 3). It is also why this one
   * spares no session — the subject proved nothing, and the plausible reason
   * for a reset is that the account is compromised.
   */
  passwordReset: "password_reset",
  /**
   * `DELETE /api/v1/admin/{staff,users}/:id` (D2.4).
   *
   * Written in the same transaction as the delete itself: `sessions` has no
   * foreign key to either population (ADR-0018), so nothing else ends them —
   * and for staff the row is gone a statement later, which would leave the
   * session rows orphaned rather than revoked. An orphan is unusable, because
   * the principal lookup after session verification finds nothing, but
   * "unusable in practice" is not what an audit trail should have to infer
   * (ADR-0028).
   */
  accountDeleted: "account_deleted",
  /**
   * A role grant changed (step 9). Roles ride in the access token's claims
   * (ADR-0018), so ending the sessions is what makes the new set take effect
   * rather than waiting out `JWT_ACCESS_TTL`.
   */
  rolesChanged: "roles_changed",
} as const;

export type RevokeReason = (typeof REVOKE_REASONS)[keyof typeof REVOKE_REASONS];

/**
 * What `refresh` needs, which is a token and not a request body.
 *
 * `refreshBody.refreshToken` became optional in ADR-0029 — a browser on cookie
 * transport sends an empty body — but "where the token came from" is the
 * controller's question. By the time the service is called there is either a
 * token or an error, so this type keeps the service's own precondition
 * unchanged rather than pushing the optionality down a layer that has no way
 * to resolve it.
 */
export interface RefreshInput {
  readonly refreshToken: string;
}

/** What {@link AuthService.revokeSessionsFor} acts on. */
export interface RevokeSessionsForInput {
  /** The account whose sessions end — **not** necessarily `ctx.principal`. */
  readonly principalId: string;
  readonly reason: RevokeReason;
  /** Spared, for a password change that must not log the caller out. */
  readonly exceptSessionId?: string | undefined;
  /**
   * Joins the caller's transaction, so "the account is disabled" and "its
   * sessions are gone" commit together (ADR-0018).
   */
  readonly tx?: DbExecutor | undefined;
}

/**
 * Longest user agent stored. The header is attacker-controlled and the column
 * is `text`; a bound here is the ADR-0020 input rule applied to something no
 * request schema covers, because it comes from the environment, not the body.
 */
export const MAX_USER_AGENT_LENGTH = 512;

export interface AuthServiceDeps {
  readonly population: Population;
  readonly principals: PrincipalAdapter;
  readonly sessions: SessionsRepository;
  readonly hasher: PasswordHasher;
  readonly tokens: TokenService;
  readonly hashLimiter: HashLimiter;
  readonly refreshTtlSec: number;
  /** `REFRESH_ROTATION_GRACE_SEC` (ADR-0004). */
  readonly rotationGraceSec: number;
  /**
   * Runs `fn` inside one database transaction. Registration inserts an
   * account, a role grant and a session; either all three land or none does.
   */
  readonly transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  readonly now?: () => Date;
  readonly newRefreshToken?: () => string;
}

export const createAuthService = ({
  population,
  principals,
  sessions,
  hasher,
  tokens,
  hashLimiter,
  refreshTtlSec,
  rotationGraceSec,
  transaction,
  now = () => new Date(),
  newRefreshToken = () => randomToken(32),
}: AuthServiceDeps) => {
  const refreshExpiryFrom = (at: Date): Date =>
    new Date(at.getTime() + refreshTtlSec * 1000);

  /**
   * Creates the session row and the access token that names it.
   *
   * The refresh token is generated here and returned to the caller exactly
   * once — only its SHA-256 digest is stored, so no later read of the database
   * can produce a usable credential (ADR-0018).
   */
  const issueSession = async (
    ctx: RequestContext,
    principal: PrincipalRecord,
    at: Date,
    tx?: DbExecutor,
  ): Promise<IssuedAuthResource> => {
    const refreshToken = newRefreshToken();
    const refreshTokenExpiresAt = refreshExpiryFrom(at);

    const session = await sessions.create(
      {
        principalType: population,
        principalId: principal.id,
        refreshTokenHash: sha256Base64url(refreshToken),
        refreshTokenExpiresAt,
        ip: ctx.ip,
        userAgent: ctx.userAgent?.slice(0, MAX_USER_AGENT_LENGTH),
      },
      tx,
    );

    const access = await tokens.issue({
      principalId: principal.id,
      population,
      sessionId: session.id,
      roles: principal.roles,
    });

    return toAuthResource({
      principal: principal.resource,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      refreshTokenExpiresAt,
    });
  };

  /** Every password comparison goes through the limiter (ADR-0020). */
  const verifyPassword = (storedHash: string, password: string) =>
    hashLimiter.run(() => hasher.verify(storedHash, password));

  return {
    /**
     * `POST /auth/login` (ADR-0018 §Login).
     *
     * The order of the checks is the decision: the password is verified
     * **before** the account status is looked at, so "this address exists but
     * is disabled" cannot be learned without the password. And the verifier
     * runs even when no account matched, against `dummyHash()` at the same
     * cost parameters, so the response time does not answer "does this email
     * exist?" either.
     */
    login: async (
      ctx: RequestContext,
      { email, password }: LoginBody,
    ): Promise<IssuedAuthResource> => {
      const at = now();
      const principal = await principals.findByEmail(email);

      // `?? dummyHash()` also covers a real account with no password
      // (`users.password_hash` is nullable, ADR-0017): null means "this
      // account has no password login", never "any password matches".
      const storedHash = principal?.passwordHash ?? (await hasher.dummyHash());
      const verified = await verifyPassword(storedHash, password);

      if (principal === undefined || !verified) {
        // No email in the log line: a failed-login line is written for every
        // guess, and a log full of addresses is a credential-stuffing list
        // with a timestamp. The request id correlates it with the access line.
        ctx.logger.warn({ population }, "login failed");

        throw invalidCredentials();
      }

      if (!principal.active) {
        ctx.logger.warn(
          { population, principalId: principal.id },
          "login refused for an inactive account",
        );

        throw accountDisabled();
      }

      // Transparent parameter upgrade (ADR-0018 §Password hashing): the
      // plaintext is only available here, so this is the one moment an
      // account hashed under older `ARGON2_*` values can be re-hashed.
      if (
        principal.passwordHash !== null &&
        hasher.needsRehash(principal.passwordHash)
      ) {
        const upgraded = await hashLimiter.run(() => hasher.hash(password));

        await principals.updatePasswordHash(principal.id, upgraded, at);
        ctx.logger.info(
          { population, principalId: principal.id },
          "password hash upgraded",
        );
      }

      const auth = await issueSession(ctx, principal, at);

      await principals.touchLastLogin(principal.id, at);

      ctx.logger.info(
        { population, principalId: principal.id },
        "login succeeded",
      );

      return auth;
    },

    /**
     * `POST /auth/refresh` (ADR-0018 §Refresh).
     *
     * Rotation with reuse detection. A token that matches the *previous* hash
     * is either a client retrying inside `REFRESH_ROTATION_GRACE_SEC` — a lost
     * response, a double-tap, two tabs — or a stolen token being replayed. The
     * window is the only thing that separates them, and outside it the session
     * is revoked rather than merely refused: if the token was replayed, the
     * legitimate holder's session is what the attacker would use next.
     */
    refresh: async (
      ctx: RequestContext,
      { refreshToken }: RefreshInput,
    ): Promise<IssuedAuthResource> => {
      const at = now();
      const presentedHash = sha256Base64url(refreshToken);

      let session = await sessions.findByRefreshTokenHash(presentedHash);

      if (session === undefined) {
        const rotated =
          await sessions.findByPreviousRefreshTokenHash(presentedHash);

        if (rotated === undefined) throw invalidRefreshToken();

        // Both of these run **before** the reuse branch, because that branch
        // has a side effect.
        //
        // Population: a session of the other population must be
        // indistinguishable from an unknown token (ADR-0019 §1). Revoking it
        // and answering `AUTH_REFRESH_REUSED` from the wrong segment would be
        // both a distinguishable code and a cross-segment state change.
        if (rotated.principalType !== population) throw invalidRefreshToken();

        // Already revoked: the ordinary "logged out, then a stale tab retried"
        // case. It is not theft, and logging it as theft is how a `warn` that
        // is supposed to mean "a token was stolen" stops meaning anything
        // (ADR-0020 §Audit trail).
        if (rotated.revokedAt !== null) throw sessionRevoked();

        const withinGrace =
          rotated.rotatedAt !== null &&
          at.getTime() - rotated.rotatedAt.getTime() <= rotationGraceSec * 1000;

        if (!withinGrace) {
          await sessions.revoke({
            id: rotated.id,
            reason: REVOKE_REASONS.refreshReuse,
            at,
          });

          ctx.logger.warn(
            {
              population: rotated.principalType,
              principalId: rotated.principalId,
              sessionId: rotated.id,
            },
            "refresh token reuse detected, session revoked",
          );

          throw refreshReused();
        }

        // Inside the window this is a legitimate retry, so it is served like
        // any other refresh: the session rotates again from its *current*
        // hash. The pair issued by the first call therefore keeps working for
        // another grace window as the new previous hash, which is what makes
        // two concurrent refreshes both succeed.
        session = rotated;
      }

      // Population first, before anything more specific: a session of the
      // other population must be indistinguishable from an unknown token, or
      // the difference becomes a probe (ADR-0019).
      if (session.principalType !== population) throw invalidRefreshToken();

      if (session.revokedAt !== null) throw sessionRevoked();
      if (session.refreshTokenExpiresAt.getTime() <= at.getTime()) {
        throw invalidRefreshToken();
      }

      const principal = await principals.findById(session.principalId);

      if (principal === undefined) {
        // The account was deleted while a session was live. `sessions` has no
        // foreign key to either population (ADR-0018), so nothing else cleans
        // this up.
        await sessions.revoke({
          id: session.id,
          reason: REVOKE_REASONS.principalMissing,
          at,
        });

        throw invalidRefreshToken();
      }

      if (!principal.active) {
        await sessions.revokeAllForPrincipal({
          principalType: population,
          principalId: principal.id,
          reason: REVOKE_REASONS.accountDisabled,
          at,
        });

        ctx.logger.warn(
          { population, principalId: principal.id },
          "refresh refused for an inactive account, sessions revoked",
        );

        throw accountDisabled();
      }

      const nextToken = newRefreshToken();
      const refreshTokenExpiresAt = refreshExpiryFrom(at);

      const rotated = await sessions.rotate({
        id: session.id,
        expectedRefreshTokenHash: session.refreshTokenHash,
        refreshTokenHash: sha256Base64url(nextToken),
        refreshTokenExpiresAt,
        at,
      });

      // Zero rows means another request rotated or revoked this session
      // between the read above and this write. Refusing is correct: the token
      // this caller holds is no longer the current one.
      if (rotated === undefined) throw invalidRefreshToken();

      const access = await tokens.issue({
        principalId: principal.id,
        population,
        sessionId: session.id,
        roles: principal.roles,
      });

      ctx.logger.info(
        { population, principalId: principal.id, sessionId: session.id },
        "session refreshed",
      );

      return toAuthResource({
        principal: principal.resource,
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt,
        refreshToken: nextToken,
        refreshTokenExpiresAt,
      });
    },

    /** `POST /auth/logout` — revokes the session the access token names. */
    logout: async (ctx: RequestContext): Promise<void> => {
      const principal = requirePopulation(ctx, population);
      const at = now();

      await sessions.revoke({
        id: principal.sessionId,
        reason: REVOKE_REASONS.logout,
        at,
      });

      ctx.logger.info(
        {
          population,
          principalId: principal.id,
          sessionId: principal.sessionId,
        },
        "logged out",
      );
    },

    /** `POST /auth/logout-all` — every device, including this one. */
    logoutAll: async (ctx: RequestContext): Promise<void> => {
      const principal = requirePopulation(ctx, population);
      const at = now();

      const revoked = await sessions.revokeAllForPrincipal({
        principalType: population,
        principalId: principal.id,
        reason: REVOKE_REASONS.logoutAll,
        at,
      });

      ctx.logger.info(
        { population, principalId: principal.id, revoked },
        "logged out of every session",
      );
    },

    /**
     * `GET /auth/me` — the principal, re-read from the database.
     *
     * Deliberately not assembled from the token's claims: `me` exists so a
     * client can resynchronise after a role or profile change, and claims are
     * up to one access-token lifetime stale (ADR-0018 §Authenticated request).
     */
    me: async (ctx: RequestContext): Promise<PrincipalResource> => {
      const authenticated = requirePopulation(ctx, population);
      const principal = await principals.findById(authenticated.id);

      if (principal === undefined || !principal.active) {
        // The account was deleted or disabled inside the token's lifetime.
        // Revoking here rather than only refusing means the refresh token dies
        // with it, instead of minting a fresh access token 15 minutes later.
        await sessions.revokeAllForPrincipal({
          principalType: population,
          principalId: authenticated.id,
          reason:
            principal === undefined
              ? REVOKE_REASONS.principalMissing
              : REVOKE_REASONS.accountDisabled,
          at: now(),
        });

        throw sessionRevoked();
      }

      return principal.resource;
    },

    /**
     * Ends every live session of one account of this population.
     *
     * The one session operation whose subject is somebody *other* than the
     * caller, which is why it takes a `principalId` and does not consult
     * `ctx.principal`: an admin revoking a staff member's sessions and a user
     * changing their own password are the same write, and authorising them is
     * the calling service's job, not this one's (ADR-0019 §3).
     *
     * It lives here rather than in the staff and users services because
     * `sessions` is the auth module's aggregate. Those services depend on this
     * one function — `Pick<AuthService, "revokeSessionsFor">` — which is the
     * "a module may depend on another module's service" rule of ADR-0009
     * narrowed to exactly what they need.
     *
     * @returns how many sessions were revoked.
     */
    revokeSessionsFor: async (
      ctx: RequestContext,
      { principalId, reason, exceptSessionId, tx }: RevokeSessionsForInput,
    ): Promise<number> => {
      const revoked = await sessions.revokeAllForPrincipal(
        {
          principalType: population,
          principalId,
          reason,
          at: now(),
          exceptSessionId,
        },
        tx,
      );

      if (revoked > 0) {
        ctx.logger.info(
          { population, principalId, revoked, reason },
          "sessions revoked",
        );
      }

      return revoked;
    },

    /**
     * `POST /api/v1/public/auth/register` (ADR-0018 §Staff onboarding).
     *
     * Answers `201` with the same body as login, so a new account is signed in
     * without a second round trip. Available on the user service only — the
     * staff adapter has no `create`, because staff cannot self-register.
     */
    register: async (
      ctx: RequestContext,
      body: RegisterBody,
    ): Promise<IssuedAuthResource> => {
      const create = principals.create;

      if (create === undefined) {
        // A wiring mistake — the public router mounts this from the user
        // service — so it is a 500, not a 403: no client can cause it.
        throw internal(
          new Error(`population "${population}" has no self-registration path`),
        );
      }

      const at = now();
      const passwordHash = await hashLimiter.run(() =>
        hasher.hash(body.password),
      );

      const auth = await transaction(async (tx) => {
        const created = await create(
          {
            email: body.email,
            passwordHash,
            firstName: body.firstName,
            lastName: body.lastName,
          },
          tx,
        );

        if (created === undefined) return undefined;

        return issueSession(ctx, created, at, tx);
      });

      if (auth === undefined) {
        // Generic conflict, and logged without the address: naming it would
        // turn an anonymous endpoint into an account-existence oracle
        // (ADR-0020 §Enumeration).
        ctx.logger.warn({ population }, "registration rejected as a duplicate");

        throw registrationConflict();
      }

      ctx.logger.info(
        { population, principalId: auth.principal.id },
        "account registered",
      );

      return auth;
    },
  } as const;
};

export type AuthService = ReturnType<typeof createAuthService>;
