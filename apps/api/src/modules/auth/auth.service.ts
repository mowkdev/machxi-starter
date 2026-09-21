import type {
  FederatedExchangeBody,
  LoginBody,
  PrincipalResource,
} from "@repo/contracts";
import { randomToken, sha256Base64url } from "@repo/crypto";

import { requirePopulation } from "../../core/auth/policies.js";
import type { RequestContext } from "../../core/context/index.js";
import { internal } from "../../core/errors/index.js";
import {
  accountDisabled,
  emailUnverified,
  federatedHandoffInvalid,
  impersonationHandoffInvalid,
  invalidCredentials,
  invalidRefreshToken,
  refreshReused,
  sessionRevoked,
} from "./auth.errors.js";
import { toAuthResource, type IssuedAuthResource } from "./auth.mapper.js";
import { createAuthMailFlows } from "./auth.mail-flows.service.js";
import { createAuthSessions } from "./auth.sessions.service.js";
import {
  REVOKE_REASONS,
  type AuthServiceDeps,
  type EndReplacedImpersonationInput,
  type IssueImpersonatedSessionInput,
  type RefreshInput,
  type ResolvedAuthDeps,
  type RevokeSessionsForInput,
} from "./auth.types.js";

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

export const createAuthService = (deps: AuthServiceDeps) => {
  const {
    population,
    principals,
    sessions,
    audit,
    hasher,
    tokens,
    hashLimiter,
    rotationGraceSec,
    impersonators,
    federated,
    accountTokens,
    transaction,
    now = () => new Date(),
    newRefreshToken = () => randomToken(32),
  } = deps;

  /**
   * The deps with the two injectables resolved once, for the factories below.
   *
   * Defaulting them here and passing the result on is what keeps the halves of
   * this service on one clock: a test that injects `now` into `createAuthService`
   * alone would otherwise leave the mail flows reading `new Date()`.
   */
  const resolved: ResolvedAuthDeps = { ...deps, now, newRefreshToken };

  const {
    refreshExpiryFrom,
    revokeEverySessionOf,
    resolveImpersonator,
    asImpersonated,
    issueSession,
  } = createAuthSessions(resolved);

  /** Every password comparison goes through the limiter (ADR-0020). */
  const verifyPassword = (storedHash: string, password: string) =>
    hashLimiter.run(() => hasher.verify(storedHash, password));

  /**
   * The seven flows of ADR-0071, composed rather than declared here.
   *
   * The returned object is this service's own: `createAuthService` is still
   * the one door, and a caller cannot tell which file a member was written in.
   */
  const mailFlows = createAuthMailFlows({
    ...resolved,
    issueSession,
    revokeEverySessionOf,
  });

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
        // Two refusals, and the split is ADR-0071 §3's: an address that was
        // never proven is a thing the caller can fix from the sign-in page,
        // and a disabled account is not. Both are raised only here, after the
        // password verified, so neither tells an anonymous guesser anything
        // (ADR-0020 §Enumeration).
        if (principal.awaitingEmailVerification) {
          ctx.logger.warn(
            { population, principalId: principal.id },
            "login refused: the address has not been confirmed",
          );

          throw emailUnverified();
        }

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
     * Ends the impersonated session a second exchange in the same browser
     * replaces (ADR-0070 §4).
     *
     * The user population's cookies are one jar, and since the admin panel now
     * stays on screen a second Impersonate is one click away. Without this, the
     * exchange would overwrite the first tab's cookies and leave its session
     * live for the rest of `IMPERSONATION_SESSION_TTL`: the stale tab's next
     * refresh would answer with the **second** customer's principal, the banner
     * would swap names, and nothing would say so on the trail. The API is the
     * only place that can see it — the refresh cookie is path-scoped to
     * `/api/v1/user/auth` and the exchange is a route under that path.
     *
     * Three conditions, and every one of them is a decision rather than a
     * defence:
     *
     * - **The row must be this population's.** Nothing else can reach the
     *   cookie's path, but a session of the other population resolving here
     *   would be a cross-segment revocation from an unauthenticated route.
     * - **The row must be live.** A revoked or expired session is already over;
     *   revoking it again would write a second `impersonation.ended` row for an
     *   impersonation that had already ended, and the audit table is the one
     *   nothing prunes.
     * - **The row must carry an actor.** A cookie that resolves to a **real**
     *   customer session is left exactly as ADR-0057 §3 decided — overwritten
     *   in the jar, alive in the database, other devices untouched. Ending it
     *   would end a session that was not the operator's to end.
     *
     * A cookie that resolves to nothing — expired, unknown, revoked — is
     * ignored, as it is on any other request, and the exchange's own refusals
     * are unchanged. Only the **current** hash is matched, and the gap that
     * leaves is deliberate rather than overlooked: a token one rotation stale
     * is still spendable at `refresh` inside `REFRESH_ROTATION_GRACE_SEC`
     * (ADR-0018 §Refresh), so a browser whose rotation response was lost keeps
     * its old impersonation alive until its fixed end. Reaching the previous
     * hash from here would put a revoke behind reuse detection's own
     * ambiguity, and the miss is bounded: the exchange overwrites the jar, so
     * the session it failed to end is one no tab can reach.
     *
     * @returns whether a session was ended, for the caller's log line — which
     * is the caller's rather than this function's because the transaction it
     * runs in can still roll back underneath it, and a log line cannot.
     */
    endReplacedImpersonation: async (
      ctx: RequestContext,
      { refreshToken, replacedBy, tx }: EndReplacedImpersonationInput,
    ): Promise<boolean> => {
      const at = now();
      const session = await sessions.findByRefreshTokenHash(
        sha256Base64url(refreshToken),
        tx,
      );

      if (
        session === undefined ||
        session.principalType !== population ||
        session.revokedAt !== null ||
        session.refreshTokenExpiresAt.getTime() <= at.getTime() ||
        session.impersonatedByStaffId === null
      ) {
        return false;
      }

      await sessions.revoke(
        {
          id: session.id,
          reason: REVOKE_REASONS.impersonationEnded,
          at,
        },
        tx,
      );

      await audit.record(
        ctx,
        {
          event: "impersonation.ended",
          identities: {
            actor: { type: "staff", id: session.impersonatedByStaffId },
            actingAs: { type: "user", id: session.principalId },
          },
          // `replaced`, and that word is the point of the row: it separates a
          // second impersonation in the same browser from the exit control's
          // `logout` and from a revocation for cause, which is the distinction
          // ADR-0057 §6 asks `data` to carry. The two ids beside it name the
          // exchange that did the replacing, whose operator is not necessarily
          // the actor above — a shared support workstation is one jar and two
          // people (ADR-0070 §4).
          data: {
            sessionId: session.id,
            reason: "replaced",
            replacedByStaffId: replacedBy.staffId,
            replacedByHandoffId: replacedBy.handoffId,
          },
        },
        tx,
      );

      return true;
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

      // Which ways in this account has (ADR-0072 §3), on the user population
      // alone: `me` is where a client resynchronises, and "Set a password" or
      // "Link Google" is decided from these two fields. Never on the
      // token-issuing bodies — login and refresh do not need them, and the
      // principal read behind them stays one statement.
      if (principal.resource.kind === "user" && federated !== undefined) {
        return {
          ...principal.resource,
          hasPassword: principal.passwordHash !== null,
          identities: await federated.identitiesOf(principal.id),
        };
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
     * `POST /api/v1/public/auth/google/exchange` (ADR-0072 §2) — the fragment
     * token the Google callback minted, for a session.
     *
     * {@link verifyEmail}'s shape inherited whole: claim the `federated_login`
     * token, re-read the account, issue the session and stamp the login, in
     * one transaction, so every refusal rolls the claim back with it.
     *
     * **The account is re-read and must still be `active`** (`D19.1`'s
     * `security-reviewer`, carried to this step). The callback checked it a
     * few seconds ago, but a disable does not supersede a live handoff, and
     * "disabled in that minute" must not open anyway — the impersonation
     * exchange's reasoning about its own mint, applied to this one.
     *
     * Every refusal is the same `401` (ADR-0020 §Enumeration): unknown, spent,
     * expired, of another purpose, or naming an account that is gone or no
     * longer active.
     */
    exchangeFederatedHandoff: async (
      ctx: RequestContext,
      { token }: FederatedExchangeBody,
    ): Promise<IssuedAuthResource> => {
      if (population !== "user") {
        // The route is mounted from the user controller on the public
        // segment; a staff twin would be a way to turn a URL fragment into an
        // operator's session, which no federated flow may mint (ADR-0072 §5).
        throw internal(
          new Error(`population "${population}" has no federated sign-in`),
        );
      }

      const at = now();

      return transaction(async (tx) => {
        const claimed = await accountTokens.consume(
          ctx,
          { purpose: "federated_login", principalType: population, token },
          tx,
        );

        if (claimed === undefined) throw federatedHandoffInvalid();

        const principal = await principals.findById(claimed.principalId, tx);

        if (principal === undefined || !principal.active) {
          ctx.logger.warn(
            { population, tokenId: claimed.id },
            "federated exchange refused: the account is gone or not active",
          );

          throw federatedHandoffInvalid();
        }

        const auth = await issueSession(ctx, principal, at, tx);

        await principals.touchLastLogin(principal.id, at, tx);

        ctx.logger.info(
          { population, principalId: principal.id },
          "signed in through a federated identity",
        );

        return auth;
      });
    },

    ...mailFlows,
  } as const;
};

export type AuthService = ReturnType<typeof createAuthService>;
