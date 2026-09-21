import type {
  ImpersonatorResource,
  PrincipalResource,
  UserPrincipalResource,
} from "@repo/contracts";
import { sha256Base64url } from "@repo/crypto";
import type { DbExecutor } from "@repo/db";

import type { RequestContext } from "../../core/context/index.js";
import { internal } from "../../core/errors/index.js";
import {
  toAuthResource,
  withImpersonator,
  type IssuedAuthResource,
} from "./auth.mapper.js";
import {
  MAX_USER_AGENT_LENGTH,
  REVOKE_REASONS,
  type PrincipalRecord,
  type ResolvedAuthDeps,
  type RevokeReason,
} from "./auth.types.js";

/**
 * The session half of the auth service: what mints a session row, what ends
 * one, and the two readings of `sessions.impersonated_by_staff_id` the wire
 * needs (ADR-0018, ADR-0057 §4, ADR-0073 §3).
 *
 * Split out of `auth.service.ts` at `D20.7` with no change of behaviour. It is
 * not a second service — nothing routes to it — but the internals *both* halves
 * of `createAuthService` reach for: the session lifecycle keeps them as its
 * own, and `createAuthMailFlows` is handed the two it needs as parameters
 * rather than building a second copy over the same tables.
 */
export const createAuthSessions = ({
  population,
  sessions,
  audit,
  tokens,
  refreshTtlSec,
  maxSessionsPerPrincipal,
  impersonationSessionTtlSec,
  impersonators,
  transaction,
  newRefreshToken,
}: ResolvedAuthDeps) => {
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
   * makes it different in four places now (ADR-0057 §4, ADR-0073 §3): the row
   * carries the actor column, the expiry is a **fixed** end rather than the
   * sliding `REFRESH_TOKEN_TTL`, the access token is both capped at that end
   * and stamped with the RFC 8693 `act` claim — and the mint does **not**
   * enforce the session cap. Absent — every login, every registration, every
   * mailed link that ends in a session, the federated exchange — nothing below
   * changes except that the cap runs.
   *
   * **The cap is here rather than in `login`**, which is the one design
   * decision in this function worth stating. Every path in this service that
   * puts a person into a session comes through here: login, registration's
   * verify, the password reset, the staff onboarding accept and the federated
   * exchange. A cap written at `login` would be a cap five callers could be
   * added without, and the sixth would be the one nobody noticed.
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

    /*
     * An impersonated mint is exempt (ADR-0073 §3): those sessions are
     * counted against the customer but are never the ones revoked, and a
     * support operator opening an account must not end the customer's oldest
     * device to make room for themselves.
     */
    const capped = impersonation === undefined && maxSessionsPerPrincipal > 0;

    const mint = async (executor: DbExecutor | undefined) => {
      const created = await sessions.create(
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
        executor,
      );

      if (!capped) return created;

      const revoked = await sessions.revokeOldestBeyondCap(
        {
          principalType: population,
          principalId: principal.id,
          max: maxSessionsPerPrincipal,
          reason: REVOKE_REASONS.sessionCap,
          at,
          exceptSessionId: created.id,
        },
        executor,
      );

      if (revoked > 0) {
        // `info`, not `warn`: this is the cap working, and a person with
        // eleven devices is not an incident. It is logged at all because the
        // effect a client sees — a session that was live a moment ago is gone
        // — otherwise has no explanation anywhere.
        ctx.logger.info(
          { population, principalId: principal.id, revoked },
          "oldest sessions revoked by the per-principal cap",
        );
      }

      return created;
    };

    /*
     * The insert and the revoke are **one transaction** (ADR-0073 §3), so a
     * mint never half-lands: either the new session and the revocation it
     * caused are both there, or neither is. `tx` is the caller's wherever
     * there is one — registration's verify, the reset, the onboarding accept
     * and the federated exchange all mint inside a transaction of their own.
     * `login` has none, so one is opened here, and only when there is cap work
     * to do: an uncapped deployment keeps login's single insert.
     *
     * **What the transaction does not buy is serialisation between two mints**
     * (`D20.4`'s `security-reviewer`). Two logins for one principal racing at
     * READ COMMITTED both read the same count and both aim at the same oldest
     * row; the `revoked_at is null` guard on the update means the loser
     * revokes nothing, so the account sits at one over the cap until its next
     * mint, which corrects it. A `SELECT … FOR UPDATE` would close it, and it
     * is deliberately not taken: it puts a row lock on every login in exchange
     * for a transient extra session, and it would make a login deadlock-able
     * against `revokeAllForPrincipal`, which ends every session of the same
     * principal in one unordered statement. A cap that is eventually exact is
     * the right trade for a sign-in path; the alternative is on the record in
     * this comment rather than in nobody's head.
     */
    const session =
      capped && tx === undefined ? await transaction(mint) : await mint(tx);

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

  return {
    refreshExpiryFrom,
    revokeEverySessionOf,
    resolveImpersonator,
    asImpersonated,
    issueSession,
  } as const;
};

export type AuthSessions = ReturnType<typeof createAuthSessions>;
