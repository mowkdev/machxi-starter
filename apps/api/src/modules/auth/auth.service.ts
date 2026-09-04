import type {
  ImpersonatorResource,
  LoginBody,
  Population,
  PrincipalResource,
  RegisterBody,
  UserPrincipalResource,
} from "@repo/contracts";
import type { PasswordHasher } from "@repo/crypto";
import { randomToken, sha256Base64url } from "@repo/crypto";
import type { DbExecutor } from "@repo/db";

import type { Audit } from "../../core/audit/index.js";
import { requirePopulation } from "../../core/auth/policies.js";
import type { RequestContext } from "../../core/context/index.js";
import { internal } from "../../core/errors/index.js";
import {
  accountDisabled,
  impersonationHandoffInvalid,
  invalidCredentials,
  invalidRefreshToken,
  refreshReused,
  registrationConflict,
  sessionRevoked,
} from "./auth.errors.js";
import type { HashLimiter } from "./auth.hash-limiter.js";
import {
  toAuthResource,
  withImpersonator,
  type IssuedAuthResource,
} from "./auth.mapper.js";
import type { OrganizationsService } from "../organizations/organizations.service.js";
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
  /**
   * The exit control on the impersonation banner (ADR-0057 §6, built at
   * `D13.5`).
   *
   * Its own reason rather than `logout`, because the audit trail has to tell
   * "the customer signed out" apart from "a support operator finished acting
   * as them" — the same distinction {@link REVOKE_REASONS.passwordReset} draws
   * against `passwordChanged`.
   */
  impersonationEnded: "impersonation_ended",
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

/** What {@link AuthService.issueImpersonatedSession} acts on (ADR-0057 §3). */
export interface IssueImpersonatedSessionInput {
  /** The customer whose account the session opens — from the consumed handoff. */
  readonly principalId: string;
  /** The staff member who minted that handoff, and this session's actor. */
  readonly staffId: string;
  /**
   * Joins the exchange's transaction, so the consume, the session row and the
   * `impersonation.exchanged` audit row commit together or not at all.
   */
  readonly tx?: DbExecutor | undefined;
}

export interface AuthServiceDeps {
  readonly population: Population;
  readonly principals: PrincipalAdapter;
  readonly sessions: SessionsRepository;
  /**
   * The audit writer (ADR-0058), for the one lifecycle event this service
   * owns: `impersonation.ended`, written when the exit control ends a session
   * minted by impersonation (ADR-0057 §6).
   *
   * Required rather than optional on both populations, even though only the
   * `user` instance can ever write a row: a dependency a caller may omit is a
   * dependency a future wiring mistake omits silently, and the failure mode
   * here is an impersonation that ends with no trail.
   */
  readonly audit: Audit;
  readonly hasher: PasswordHasher;
  readonly tokens: TokenService;
  readonly hashLimiter: HashLimiter;
  readonly refreshTtlSec: number;
  /** `REFRESH_ROTATION_GRACE_SEC` (ADR-0004). */
  readonly rotationGraceSec: number;
  /**
   * `IMPERSONATION_SESSION_TTL` (ADR-0004, ADR-0057 §4) — the **fixed** life of
   * a session minted by impersonation, anchored at the exchange and never
   * extended by a rotation.
   */
  readonly impersonationSessionTtlSec: number;
  /**
   * The staff adapter narrowed to one lookup, wired on the **user** service
   * only (ADR-0057 §4).
   *
   * It is what turns `sessions.impersonated_by_staff_id` into the
   * `impersonatedBy: { id, email }` the banner renders from — resolved at the
   * auth endpoints (exchange, refresh, `me`), never per request. Absent on the
   * staff service, because a staff session is never impersonated: the mint is
   * `/admin/users/:id` only, and a service that could not look a staff member
   * up is a service that cannot accidentally attribute one.
   */
  readonly impersonators?: Pick<PrincipalAdapter, "findById"> | undefined;
  /**
   * The organizations service narrowed to one function, wired on the **user**
   * service only — a service-to-service edge of the kind ADR-0009 permits.
   *
   * `register` is one of the three paths that bring a user into existence, and
   * ADR-0067 §2 requires all three to create the account's personal
   * organization *in the same transaction*: that is what makes "no query
   * anywhere has a no-organization branch" a property of the database rather
   * than a habit. Absent on the staff service, because staff cannot
   * self-register and are never members of an organization (§3) — a service
   * that could not create one is a service that cannot accidentally create one
   * for an operator.
   */
  readonly organizations?:
    Pick<OrganizationsService, "ensurePersonalOrganizationFor"> | undefined;
  /**
   * Runs `fn` inside one database transaction. Registration inserts an
   * account, a role grant, its personal organization with an `owner`
   * membership, and a session; either all of them land or none does.
   */
  readonly transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  readonly now?: () => Date;
  readonly newRefreshToken?: () => string;
}

export const createAuthService = ({
  population,
  principals,
  sessions,
  audit,
  hasher,
  tokens,
  hashLimiter,
  refreshTtlSec,
  rotationGraceSec,
  impersonationSessionTtlSec,
  impersonators,
  organizations,
  transaction,
  now = () => new Date(),
  newRefreshToken = () => randomToken(32),
}: AuthServiceDeps) => {
  const refreshExpiryFrom = (at: Date): Date =>
    new Date(at.getTime() + refreshTtlSec * 1000);

  /**
   * Every "end this account's sessions" path of this service, in one place
   * (ADR-0057 §6, amended `D13.5`).
   *
   * Two predicates, not one. `revokeAllForPrincipal` matches the rows whose
   * `principal_id` is the account — which is what every revocation in the API
   * has ever meant — and on the **staff** population a second statement
   * matches the rows that account is *impersonating through*. Those rows are
   * `principal_type = 'user'` carrying a customer's id, so the first predicate
   * cannot see them: disabling an operator, deleting them, or pressing the
   * forced-logout button would otherwise leave them a full-access customer
   * session for the rest of `IMPERSONATION_SESSION_TTL`.
   *
   * It runs on **every** staff revoke-all path rather than only the three
   * ADR-0057 §6 enumerated, which is the amendment this function is: a
   * revocation that must not reach an impersonated session does not exist, and
   * a seventh path added later inherits the sweep instead of having to
   * remember it. `exceptSessionId` is deliberately not carried across — it
   * spares the caller's own *staff* session, and an impersonated session is a
   * different row of a different population that the caller is not on.
   *
   * Each ended row gets an **`impersonation.ended` audit row of its own**, on
   * `record`'s lifecycle discipline and inside the caller's transaction
   * (`D13.5`, out of `security-reviewer`'s finding 2). Without it the exit
   * control produced `minted → exchanged → ended` and an operator revoked *for
   * cause* — the case this sweep exists for, and the one an incident actually
   * queries — produced `minted → exchanged → ` nothing at all, with
   * `sessions.revoked_reason` as the only trace: a prunable free-text column,
   * which is exactly the near-audit ADR-0058 §Context was written to replace.
   *
   * Ordinary sessions are untouched by construction: `impersonated_by_staff_id`
   * is null on all of them, and the second predicate is an equality on it — so
   * on the user population nothing below the first statement runs at all.
   */
  const revokeEverySessionOf = async (
    ctx: RequestContext,
    input: {
      readonly principalId: string;
      readonly reason: RevokeReason;
      readonly at: Date;
      readonly exceptSessionId?: string | undefined;
    },
    tx?: DbExecutor,
  ): Promise<{ readonly revoked: number; readonly impersonated: number }> => {
    const revoked = await sessions.revokeAllForPrincipal(
      {
        principalType: population,
        principalId: input.principalId,
        reason: input.reason,
        at: input.at,
        exceptSessionId: input.exceptSessionId,
      },
      tx,
    );

    if (population !== "staff") return { revoked, impersonated: 0 };

    const ended = await sessions.revokeAllImpersonatedBy(
      {
        staffId: input.principalId,
        // Its own reason, never the caller's: the audit trail has to be able
        // to tell "this staff session was revoked" from "the customer sessions
        // that staff member was driving ended with it".
        reason: REVOKE_REASONS.impersonationEnded,
        at: input.at,
      },
      tx,
    );

    for (const session of ended) {
      await audit.record(
        ctx,
        {
          event: "impersonation.ended",
          identities: {
            actor: { type: "staff", id: input.principalId },
            actingAs: { type: "user", id: session.principalId },
          },
          // `reason` is the revocation that ended it — `account_disabled`,
          // `account_deleted`, `admin_revoke` — which is the difference
          // between "the operator left" and "the operator was removed", and
          // the first question asked of a row like this.
          data: { sessionId: session.id, reason: input.reason },
        },
        tx,
      );
    }

    return { revoked, impersonated: ended.length };
  };

  /**
   * `sessions.impersonated_by_staff_id` → the wire field the banner renders
   * from (ADR-0057 §4).
   *
   * Resolved from the `staff` table at the auth endpoints only — the exchange,
   * refresh and `me`, all of which already hold the session row — and never
   * per authenticated request: an ordinary request reads the id off the access
   * token's `act` claim instead (`D13.5`).
   *
   * A staff member hard-deleted (ADR-0028) mid-impersonation resolves to
   * `undefined`, and the session keeps working without a banner. That is the
   * lesser of two wrongs on this path: the alternative is ending a support
   * operator's session because somebody else's account was closed, and the
   * attribution survives on the session row either way. The **exchange**
   * answers it differently — see {@link issueImpersonatedSession}, where a
   * session that could never show a banner is refused rather than created.
   */
  const resolveImpersonator = async (
    staffId: string,
  ): Promise<ImpersonatorResource | undefined> => {
    const record = await impersonators?.findById(staffId);

    return record === undefined
      ? undefined
      : { id: record.id, email: record.email };
  };

  /**
   * Attaches the actor to a principal that is about to go on the wire.
   *
   * `PrincipalRecord.resource` is the union and `withImpersonator` takes the
   * customer shape alone, so the narrowing has to happen somewhere. Stated as
   * a refusal rather than a cast: the branch is unreachable today — only the
   * user-population service is wired with `impersonators` — and a future
   * second mint path must fail loudly here rather than quietly putting an
   * actor on a staff principal (ADR-0057 §4).
   */
  const asImpersonated = (
    resource: PrincipalResource,
    staff: ImpersonatorResource,
  ): UserPrincipalResource => {
    if (resource.kind !== "user") {
      throw internal(
        new Error(
          "only a user principal can be impersonated (ADR-0057 §4): the mint is /admin/users/:id only",
        ),
      );
    }

    return withImpersonator(resource, staff);
  };

  /**
   * Creates the session row and the access token that names it.
   *
   * The refresh token is generated here and returned to the caller exactly
   * once — only its SHA-256 digest is stored, so no later read of the database
   * can produce a usable credential (ADR-0018).
   *
   * `impersonation` is the one thing that makes a session different, and it
   * makes it different in three places at once (ADR-0057 §4): the row carries
   * the actor column, the expiry is a **fixed** end rather than the sliding
   * `REFRESH_TOKEN_TTL`, and the access token is both capped at that end and
   * stamped with the RFC 8693 `act` claim. Absent — every login, every
   * registration — nothing below changes at all.
   */
  const issueSession = async (
    ctx: RequestContext,
    principal: PrincipalRecord,
    at: Date,
    tx?: DbExecutor,
    impersonation?: ImpersonatorResource,
  ): Promise<IssuedAuthResource> => {
    const refreshToken = newRefreshToken();
    const refreshTokenExpiresAt =
      impersonation === undefined
        ? refreshExpiryFrom(at)
        : new Date(at.getTime() + impersonationSessionTtlSec * 1000);

    const session = await sessions.create(
      {
        principalType: population,
        principalId: principal.id,
        refreshTokenHash: sha256Base64url(refreshToken),
        refreshTokenExpiresAt,
        ip: ctx.ip,
        userAgent: ctx.userAgent?.slice(0, MAX_USER_AGENT_LENGTH),
        ...(impersonation === undefined
          ? {}
          : { impersonatedByStaffId: impersonation.id }),
      },
      tx,
    );

    const access = await tokens.issue({
      principalId: principal.id,
      population,
      sessionId: session.id,
      roles: principal.roles,
      ...(impersonation === undefined
        ? {}
        : {
            // No JWT outlives the session it names (ADR-0057 §4).
            notAfter: refreshTokenExpiresAt,
            actorId: impersonation.id,
          }),
    });

    return toAuthResource({
      principal:
        impersonation === undefined
          ? principal.resource
          : asImpersonated(principal.resource, impersonation),
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
        await revokeEverySessionOf(ctx, {
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
      // **Rotation without extension** — the one change ADR-0057 §4 makes to
      // this flow, and it applies only while the actor column is set. An
      // impersonated session keeps the end anchored at its exchange, so
      // reloading the customer app survives (the session does) while the
      // window does not move. An impersonation that needs more time is
      // re-minted, on the trail, never extended.
      const actorId = session.impersonatedByStaffId;
      const refreshTokenExpiresAt =
        actorId === null
          ? refreshExpiryFrom(at)
          : session.refreshTokenExpiresAt;

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

      // Resolved from the row rather than carried from the exchange, which is
      // what makes the banner survive a reload: the session is the source of
      // truth, and this is one of the three endpoints ADR-0057 §4 lets it be
      // read at.
      const impersonatedBy =
        actorId === null ? undefined : await resolveImpersonator(actorId);

      const access = await tokens.issue({
        principalId: principal.id,
        population,
        sessionId: session.id,
        roles: principal.roles,
        ...(actorId === null
          ? {}
          : { notAfter: refreshTokenExpiresAt, actorId }),
      });

      ctx.logger.info(
        {
          population,
          principalId: principal.id,
          sessionId: session.id,
          ...(actorId === null ? {} : { impersonatedBy: actorId }),
        },
        "session refreshed",
      );

      return toAuthResource({
        principal:
          impersonatedBy === undefined
            ? principal.resource
            : asImpersonated(principal.resource, impersonatedBy),
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt,
        refreshToken: nextToken,
        refreshTokenExpiresAt,
      });
    },

    /**
     * The exchange's half of `POST /user/auth/impersonate` (ADR-0057 §3, §4).
     *
     * The handoff has already been consumed atomically by the impersonation
     * service; what is left is the part only this module may do, because
     * `sessions` is its aggregate. Everything a login session gets, an
     * impersonated one gets too — rotation, reuse detection, the grace window
     * — and the three deltas are all inside {@link issueSession}.
     *
     * Both accounts are re-read here rather than trusted from the handoff row,
     * and each refusal is the same one:
     *
     * - **The target** must still be a live, active customer. A minute passes
     *   between the mint and the exchange at most, but "the account was
     *   disabled in that minute" must not open anyway, and the mint's check
     *   cannot speak for the exchange's instant.
     * - **The minting staff member** must still exist and be active. A session
     *   whose actor cannot be resolved is a session the customer app can never
     *   draw a banner on (ADR-0057 §7 makes that banner unremovable), and an
     *   impersonation nobody can see is the thing this whole record exists to
     *   prevent. Refusing here is not the same judgement {@link
     *   resolveImpersonator} makes on refresh: there a session already exists
     *   and ending it would punish the operator for somebody else's deletion.
     *
     * It never throws a *distinguishable* error: refusals go out as the
     * impersonation service's one indistinguishable `401`, so the exchange
     * cannot be used to ask whether an account exists, is disabled, or was
     * already redeemed (ADR-0020 §Enumeration).
     *
     * @throws AppError `UNAUTHENTICATED` for every refusal.
     */
    issueImpersonatedSession: async (
      ctx: RequestContext,
      { principalId, staffId, tx }: IssueImpersonatedSessionInput,
    ): Promise<IssuedAuthResource> => {
      const at = now();

      // Sequential rather than `Promise.all`: both reads run on the exchange's
      // transaction, which is one reserved connection, so concurrency here buys
      // nothing and only raises the question of what two in-flight statements
      // on one transaction do.
      const target = await principals.findById(principalId, tx);
      // `undefined` when this service has no staff adapter at all — the staff
      // population's instance, which therefore refuses below. A staff session
      // is never impersonated (ADR-0057 §4), and this is what makes that a
      // property of the wiring rather than of a caller's discipline.
      const actor = await impersonators?.findById(staffId, tx);

      if (target === undefined || !target.active) {
        ctx.logger.warn(
          { population, principalId, staffId },
          "impersonation exchange refused: the target is not an active account",
        );

        throw impersonationHandoffInvalid();
      }

      if (actor === undefined || !actor.active) {
        ctx.logger.warn(
          { population, principalId, staffId },
          "impersonation exchange refused: the minting staff member is gone or inactive",
        );

        throw impersonationHandoffInvalid();
      }

      const auth = await issueSession(ctx, target, at, tx, {
        id: actor.id,
        email: actor.email,
      });

      ctx.logger.info(
        {
          population,
          principalId: target.id,
          impersonatedBy: actor.id,
          endsAt: auth.refreshTokenExpiresAt,
        },
        "impersonated session issued",
      );

      return auth;
    },

    /**
     * `POST /auth/logout` — revokes the session the access token names.
     *
     * **And it is the impersonation exit** (ADR-0057 §6). `logout` is
     * deliberately not on §5's exclusion list, because the banner's one
     * control calls it: the operator leaves the same way the customer would.
     * What changes when the actor column is set is the reason written to the
     * row and one audit event — the trail has to tell "the customer signed
     * out" apart from "a support operator finished acting as them", the same
     * distinction `passwordReset` draws against `passwordChanged`.
     *
     * The impersonated branch is transactional: the revoke and the
     * `impersonation.ended` row commit together, on `audit.record`'s lifecycle
     * discipline, so no impersonation can end without its trail (ADR-0058).
     * An ordinary logout takes the identical single-statement path it always
     * has, transaction included — there is nothing to join.
     */
    logout: async (ctx: RequestContext): Promise<void> => {
      const principal = requirePopulation(ctx, population);
      const at = now();
      const actorId =
        principal.kind === "user" ? principal.impersonatedBy : undefined;

      if (actorId === undefined) {
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

        return;
      }

      await transaction(async (tx) => {
        await sessions.revoke(
          {
            id: principal.sessionId,
            reason: REVOKE_REASONS.impersonationEnded,
            at,
          },
          tx,
        );

        await audit.record(
          ctx,
          {
            event: "impersonation.ended",
            // Explicit rather than derived, even though `ctx.principal` would
            // derive the same pair here: this row states the two identities
            // the event is *about*, and a reader of this call site should not
            // have to open the audit service to find out which way round they
            // go (ADR-0058).
            identities: {
              actor: { type: "staff", id: actorId },
              actingAs: { type: "user", id: principal.id },
            },
            data: { sessionId: principal.sessionId, reason: "logout" },
          },
          tx,
        );
      });

      ctx.logger.info(
        {
          population,
          principalId: principal.id,
          sessionId: principal.sessionId,
          impersonatedBy: actorId,
        },
        "impersonation ended",
      );
    },

    /**
     * `POST /auth/logout-all` — every device, including this one.
     *
     * On the user segment this is one of ADR-0057 §5's excluded operations and
     * an impersonated caller never reaches it: `refuseImpersonated` is mounted
     * on the route, because ending the *customer's* real sessions everywhere
     * is a takeover step and not support work.
     */
    logoutAll: async (ctx: RequestContext): Promise<void> => {
      const principal = requirePopulation(ctx, population);
      const at = now();

      const { revoked, impersonated } = await revokeEverySessionOf(ctx, {
        principalId: principal.id,
        reason: REVOKE_REASONS.logoutAll,
        at,
      });

      ctx.logger.info(
        { population, principalId: principal.id, revoked, impersonated },
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
    // `impersonatedBy` is deliberately absent from this response, and ADR-0057
    // §4 was amended at `D13.4` to say so rather than leaving the decision in
    // this comment: `me` is the resynchronisation endpoint, both SPAs boot off
    // `refresh` (which carries the field), and resolving it here would cost a
    // second primary-key probe on every `me` of both populations — including
    // every ordinary one — for a client that has already been told.
    me: async (ctx: RequestContext): Promise<PrincipalResource> => {
      const authenticated = requirePopulation(ctx, population);
      const principal = await principals.findById(authenticated.id);

      if (principal === undefined || !principal.active) {
        // The account was deleted or disabled inside the token's lifetime.
        // Revoking here rather than only refusing means the refresh token dies
        // with it, instead of minting a fresh access token 15 minutes later.
        await revokeEverySessionOf(ctx, {
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
      const { revoked, impersonated } = await revokeEverySessionOf(
        ctx,
        { principalId, reason, at: now(), exceptSessionId },
        tx,
      );

      if (revoked > 0 || impersonated > 0) {
        ctx.logger.info(
          { population, principalId, revoked, impersonated, reason },
          "sessions revoked",
        );
      }

      // The account's **own** sessions, which is what every caller counts and
      // reports. The impersonated rows are a different population's and are on
      // the log line above rather than in this number.
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

      if (organizations === undefined) {
        // The same class of wiring mistake, and refused as loudly: a
        // population that can self-register must be able to create the
        // personal organization in the same transaction (ADR-0067 §2). Serving
        // the request without one would leave an account that every
        // organization-scoped query has no branch for — the failure this
        // check exists to make impossible rather than rare.
        throw internal(
          new Error(`population "${population}" has no organizations service`),
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

        // In the transaction that inserted the account, before the session is
        // issued: the new principal's first request must already find its
        // organization there (ADR-0067 §2). The name columns come from the
        // body rather than from `created.resource`, which is the union of both
        // populations' resources here — same two values, no narrowing, and
        // the derivation itself lives in `@repo/db` beside the one the
        // backfill migration wrote in SQL.
        await organizations.ensurePersonalOrganizationFor(
          ctx,
          {
            id: created.id,
            email: created.email,
            firstName: body.firstName ?? null,
            lastName: body.lastName ?? null,
          },
          tx,
        );

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
