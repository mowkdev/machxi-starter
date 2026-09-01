import type {
  ImpersonateBody,
  ImpersonationHandoffResource,
  UserResource,
} from "@repo/contracts";
import { randomToken, sha256Base64url } from "@repo/crypto";
import type { DbExecutor } from "@repo/db";

import type { Audit, AuditIdentities } from "../../core/audit/index.js";
import { requirePopulation } from "../../core/auth/index.js";
import type { RequestContext } from "../../core/context/index.js";
import { conflict } from "../../core/errors/index.js";
import { userDeleted } from "../users/users.errors.js";
import { impersonationHandoffInvalid } from "./auth.errors.js";
import type { HandoffsRepository } from "./auth.impersonation.repository.js";
import type { IssuedAuthResource } from "./auth.mapper.js";
import type { AuthService } from "./auth.service.js";

/**
 * The mint and the exchange (ADR-0057 §1–§4).
 *
 * Two endpoints on two segments, one flow, and the whole design is the seam
 * between them: the mint answers a staff request with a **handoff token and no
 * cookie of any kind**, and the exchange trades that token for a customer
 * session on the other segment. Nothing else can move a session across
 * populations, and the staff session that asked is never touched by either
 * half (ADR-0056's "each segment touches only its own", inherited).
 *
 * It lives in the auth module because a handoff is an authentication
 * credential and the thing it is exchanged for is a `sessions` row, which is
 * this module's aggregate. It reaches the users module the way ADR-0009 asks —
 * through a service, narrowed to the one question it has ({@link
 * ImpersonationTargets}) — and never through the `users` table.
 */

/**
 * The one question this service asks the users module: *what is this account?*
 *
 * Declared here as a structural type rather than imported as
 * `Pick<UsersService, "getById">`, and that is deliberate: `users.service.ts`
 * imports this module for `REVOKE_REASONS` and `currentPasswordInvalid`, so
 * naming its type here would close a cycle between two module barrels for a
 * dependency that is one function wide. The container passes the real service.
 */
export interface ImpersonationTargets {
  readonly getById: (ctx: RequestContext, id: string) => Promise<UserResource>;
}

/**
 * The mint's bound on the two values that come from the environment rather
 * than from a schema (ADR-0020, and the `D13.2` review's finding 5 applied a
 * second time).
 *
 * The same 512 `sessions` and `audit_events` already use. The user agent is
 * attacker-controlled and unbounded; the address is taken from `ctx.ip` and
 * nothing else, which the context middleware has already refused to set unless
 * `node:net` agrees it is an IP — the `inet` column would otherwise raise
 * `22P02` and turn a hostile header into a `500`.
 */
export const MAX_HANDOFF_USER_AGENT_LENGTH = 512;

export interface ImpersonationServiceDeps {
  readonly handoffs: HandoffsRepository;
  readonly targets: ImpersonationTargets;
  /**
   * The **user** population's auth service, narrowed to the one function this
   * flow needs. `sessions` is the auth module's aggregate, so "open a session
   * as this customer" is a service call rather than a second write path
   * (ADR-0009).
   */
  readonly sessions: Pick<AuthService, "issueImpersonatedSession">;
  readonly audit: Audit;
  /** `IMPERSONATION_HANDOFF_TTL` (ADR-0004, ADR-0057 §2) — 60 seconds by default. */
  readonly handoffTtlSec: number;
  readonly transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  readonly now?: () => Date;
  /** Injected for the same reason `newRefreshToken` is (ADR-0018 §Testability). */
  readonly newHandoffToken?: () => string;
}

export const createImpersonationService = ({
  handoffs,
  targets,
  sessions,
  audit,
  handoffTtlSec,
  transaction,
  now = () => new Date(),
  newHandoffToken = () => randomToken(32),
}: ImpersonationServiceDeps) => {
  /**
   * Both identities of an impersonation row, in ADR-0058's terms.
   *
   * Written out at each call site's expense rather than derived from
   * `ctx.principal`, because the two events have different contexts and only
   * one of them has a principal at all: the exchange is served on an
   * unauthenticated route, so its identities come off the consumed handoff row.
   * Getting the order wrong is the failure `identitiesFromPrincipal`'s doc
   * comment describes — the actor is the staff member who chose to act.
   */
  const identities = (staffId: string, userId: string): AuditIdentities => ({
    actor: { type: "staff", id: staffId },
    actingAs: { type: "user", id: userId },
  });

  return {
    /**
     * `POST /api/v1/admin/users/:id/impersonate` (ADR-0057 §1).
     *
     * Refuses before a token exists if the target is not an active,
     * non-deleted customer. Unlike the exchange, these refusals are
     * distinguishable and that is correct: the caller is authenticated staff
     * who may already list every customer and read the account's status, so
     * there is no oracle to close — and an operator who is told "that account
     * is disabled" does not open a support ticket about a broken button.
     *
     * The audit row is written **inside** the transaction that stores the
     * handoff, on `audit.record`'s lifecycle discipline: a mint that cannot be
     * audited does not happen (ADR-0058).
     */
    mint: async (
      ctx: RequestContext,
      userId: string,
    ): Promise<ImpersonationHandoffResource> => {
      const staff = requirePopulation(ctx, "staff");
      const at = now();

      // `404` for an unknown or soft-deleted account, `409 USER_DELETED` for a
      // row that is present but deleted — the users module's own answers, so
      // this endpoint agrees with every other write aimed at a user (ADR-0028).
      const target = await targets.getById(ctx, userId);

      // The users module's own factory, imported from the file rather than the
      // barrel: `users.errors.ts` reaches only `core/errors`, so there is no
      // cycle to avoid here, and a hand-rolled `conflict("…", "USER_DELETED")`
      // would be a second copy of one state check's answer, free to drift from
      // the endpoint beside it (ADR-0013).
      if (target.deletedAt !== null) throw userDeleted();

      if (target.status !== "active") {
        // No code of its own: nothing branches on it, and ADR-0013 reserves
        // plain `CONFLICT` for exactly this — a state the request conflicts
        // with that no domain code names. `AUTH_ACCOUNT_DISABLED` would be a
        // lie about whose account was refused.
        throw conflict("This account is not active and cannot be impersonated");
      }

      const token = newHandoffToken();
      const expiresAt = new Date(at.getTime() + handoffTtlSec * 1000);

      await transaction(async (tx) => {
        const handoff = await handoffs.create(
          {
            tokenHash: sha256Base64url(token),
            staffId: staff.id,
            userId: target.id,
            expiresAt,
            ip: ctx.ip,
            userAgent: ctx.userAgent?.slice(0, MAX_HANDOFF_USER_AGENT_LENGTH),
          },
          tx,
        );

        await audit.record(
          ctx,
          {
            event: "impersonation.minted",
            identities: identities(staff.id, target.id),
            // The handoff's id, never the token or its hash: this table is the
            // one nothing prunes, and a credential in it would outlive every
            // rotation (ADR-0058).
            data: { handoffId: handoff.id, expiresAt: expiresAt.toISOString() },
          },
          tx,
        );
      });

      ctx.logger.info(
        { principalId: staff.id, targetUserId: target.id },
        "impersonation handoff minted",
      );

      return { token, expiresAt: expiresAt.toISOString() };
    },

    /**
     * `POST /api/v1/user/auth/impersonate` (ADR-0057 §3).
     *
     * Unauthenticated — the token *is* the credential — and single-use by the
     * shape of one statement: the consume is an `update … where consumed_at is
     * null` whose `returning` is the read, so a replay inside any window
     * updates nothing and is refused with no session minted.
     *
     * Everything commits together: the consume, the session row and the
     * `impersonation.exchanged` row share the transaction, so there is no
     * ordering in which a token is spent without a session, or a session
     * exists without a trail.
     */
    exchange: async (
      ctx: RequestContext,
      { token }: ImpersonateBody,
    ): Promise<IssuedAuthResource> =>
      transaction(async (tx) => {
        const handoff = await handoffs.consume(
          { tokenHash: sha256Base64url(token), at: now() },
          tx,
        );

        if (handoff === undefined) {
          // No identifying detail in the line: this endpoint is anonymous, and
          // a log full of rejected handoffs with their targets is a list of
          // who support looked at. The request id correlates it.
          ctx.logger.warn(
            {},
            "impersonation exchange refused: no redeemable handoff",
          );

          throw impersonationHandoffInvalid();
        }

        const auth = await sessions.issueImpersonatedSession(ctx, {
          principalId: handoff.userId,
          staffId: handoff.staffId,
          tx,
        });

        await audit.record(
          ctx,
          {
            event: "impersonation.exchanged",
            identities: identities(handoff.staffId, handoff.userId),
            // The session's fixed end, which the mint could not know: it is
            // anchored here, at the exchange (ADR-0057 §4). Recording it is
            // what makes an un-exited trail complete by construction — expiry
            // needs no event of its own (§6).
            data: {
              handoffId: handoff.id,
              endsAt: auth.refreshTokenExpiresAt,
            },
          },
          tx,
        );

        return auth;
      }),
  } as const;
};

export type ImpersonationService = ReturnType<
  typeof createImpersonationService
>;
