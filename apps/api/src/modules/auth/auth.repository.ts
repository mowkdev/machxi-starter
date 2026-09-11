import type { Population } from "@repo/contracts";
import { sessions, type DbExecutor } from "@repo/db";
import { and, eq, isNull, ne } from "drizzle-orm";

import { internal } from "../../core/errors/index.js";

/**
 * Every query against `sessions` (ADR-0009, ADR-0018).
 *
 * The table is owned by the auth module: it exists because of login, is
 * rotated by refresh and is revoked by logout, and nothing outside this module
 * has a reason to write it. Step 9's "revoke this account's sessions" admin
 * endpoints call {@link SessionsRepository.revokeAllForPrincipal} rather than
 * reaching for the table.
 */

/** The columns the auth service reads. `refresh_token_hash` never leaves this layer. */
export interface SessionRecord {
  readonly id: string;
  readonly principalType: Population;
  readonly principalId: string;
  readonly refreshTokenHash: string;
  readonly previousRefreshTokenHash: string | null;
  readonly refreshTokenExpiresAt: Date;
  readonly rotatedAt: Date | null;
  readonly revokedAt: Date | null;
  /**
   * The staff member acting as this session's principal, or `null` on every
   * ordinary session (ADR-0057 §4).
   *
   * Read on the two paths that must behave differently for an impersonated
   * session: refresh, which declines to slide the expiry while it is set, and
   * `authenticate`, which puts both identities on the request (`D13.5`).
   */
  readonly impersonatedByStaffId: string | null;
}

export interface NewSessionInput {
  readonly principalType: Population;
  readonly principalId: string;
  readonly refreshTokenHash: string;
  readonly refreshTokenExpiresAt: Date;
  readonly ip?: string | undefined;
  readonly userAgent?: string | undefined;
  /**
   * Set only by the impersonation exchange (ADR-0057 §4). Every other caller
   * omits it and the column stays null, which is what makes an ordinary
   * session recognisable as one.
   */
  readonly impersonatedByStaffId?: string | undefined;
}

export interface RotateSessionInput {
  readonly id: string;
  /**
   * The hash this rotation replaces. It is part of the `where` clause, not
   * just of the payload: two refreshes racing on the same session would
   * otherwise both succeed and the loser would hand its client a refresh token
   * that no row references. With the guard, exactly one update matches and the
   * other sees zero rows and can answer honestly.
   */
  readonly expectedRefreshTokenHash: string;
  readonly refreshTokenHash: string;
  /**
   * Where the session's expiry lands after this rotation.
   *
   * A parameter rather than something this layer computes, because the two
   * session classes answer it differently and only the service knows which it
   * holds: an ordinary session slides to now + `REFRESH_TOKEN_TTL`, and an
   * impersonated one is handed **its own current value** — rotation does not
   * extend a fixed end (ADR-0057 §4).
   */
  readonly refreshTokenExpiresAt: Date;
  readonly at: Date;
}

export interface RevokeInput {
  readonly id: string;
  readonly reason: string;
  readonly at: Date;
}

export interface RevokeAllInput {
  readonly principalType: Population;
  readonly principalId: string;
  readonly reason: string;
  readonly at: Date;
  /**
   * A session to leave alone — the caller's own, when a password change
   * revokes every *other* device (step 9). Omitted, nothing is spared, which
   * is what `logout-all` and the admin forced logout want.
   */
  readonly exceptSessionId?: string | undefined;
}

/**
 * One session ended by {@link SessionsRepository.revokeAllImpersonatedBy}.
 *
 * The customer's id, because that is what the `impersonation.ended` audit row
 * needs for its acting-as and what only the row can supply: the caller knows
 * which staff member it revoked and has no idea whose accounts they were in.
 */
export interface EndedImpersonation {
  readonly id: string;
  readonly principalId: string;
}

/** What {@link SessionsRepository.revokeAllImpersonatedBy} acts on (ADR-0057 §6). */
export interface RevokeAllImpersonatedByInput {
  /** The staff member in `impersonated_by_staff_id` — never the session's own principal. */
  readonly staffId: string;
  readonly reason: string;
  readonly at: Date;
}

/** Selected by every read, so a caller cannot depend on a column by accident. */
const recordColumns = {
  id: sessions.id,
  principalType: sessions.principalType,
  principalId: sessions.principalId,
  refreshTokenHash: sessions.refreshTokenHash,
  previousRefreshTokenHash: sessions.previousRefreshTokenHash,
  refreshTokenExpiresAt: sessions.refreshTokenExpiresAt,
  rotatedAt: sessions.rotatedAt,
  revokedAt: sessions.revokedAt,
  impersonatedByStaffId: sessions.impersonatedByStaffId,
} as const;

export const createSessionsRepository = (db: DbExecutor) =>
  ({
    create: async (
      input: NewSessionInput,
      tx: DbExecutor = db,
    ): Promise<SessionRecord> => {
      const [created] = await tx
        .insert(sessions)
        .values({
          principalType: input.principalType,
          principalId: input.principalId,
          refreshTokenHash: input.refreshTokenHash,
          refreshTokenExpiresAt: input.refreshTokenExpiresAt,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          impersonatedByStaffId: input.impersonatedByStaffId ?? null,
        })
        .returning(recordColumns);

      if (created === undefined) {
        // Unreachable: a plain insert either returns its row or throws. Stated
        // rather than asserted so the type is honest without a non-null `!`,
        // and raised through the factory because `AppError` is the only error
        // type this code base has (ADR-0013).
        throw internal(new Error("sessions.create inserted no row"));
      }

      return created;
    },

    /** The per-request lookup behind `authenticate` — a primary-key probe (ADR-0018). */
    findById: async (
      id: string,
      tx: DbExecutor = db,
    ): Promise<SessionRecord | undefined> => {
      const [row] = await tx
        .select(recordColumns)
        .from(sessions)
        .where(eq(sessions.id, id))
        .limit(1);

      return row;
    },

    /**
     * When a session began, and whose it is — revoked or not, because a
     * revoked row still says when it started (ADR-0072 §3, amended after
     * `D19.4`).
     *
     * The session-minted reset's one question: its link sealed the asking
     * session's id, and the consume keeps only the identities older than that
     * session. A narrow probe of its own rather than a column on
     * {@link SessionRecord}, which every other read would then carry for this
     * one reader.
     */
    findStartedAt: async (
      id: string,
      tx: DbExecutor = db,
    ): Promise<
      | {
          readonly principalType: Population;
          readonly principalId: string;
          readonly createdAt: Date;
        }
      | undefined
    > => {
      const [row] = await tx
        .select({
          principalType: sessions.principalType,
          principalId: sessions.principalId,
          createdAt: sessions.createdAt,
        })
        .from(sessions)
        .where(eq(sessions.id, id))
        .limit(1);

      return row;
    },

    /** Indexed equality on the unique current hash. */
    findByRefreshTokenHash: async (
      hash: string,
      tx: DbExecutor = db,
    ): Promise<SessionRecord | undefined> => {
      const [row] = await tx
        .select(recordColumns)
        .from(sessions)
        .where(eq(sessions.refreshTokenHash, hash))
        .limit(1);

      return row;
    },

    /**
     * Indexed equality on the rotated-out hash. A hit here is either a client
     * retrying inside the grace window or a replayed token — the service
     * decides which, because only it knows the window (ADR-0018 §Refresh).
     */
    findByPreviousRefreshTokenHash: async (
      hash: string,
      tx: DbExecutor = db,
    ): Promise<SessionRecord | undefined> => {
      const [row] = await tx
        .select(recordColumns)
        .from(sessions)
        .where(eq(sessions.previousRefreshTokenHash, hash))
        .limit(1);

      return row;
    },

    /**
     * Rotates the token pair and slides the expiry.
     *
     * @returns the updated row, or `undefined` when the session was revoked or
     *   already rotated by a concurrent request.
     */
    rotate: async (
      input: RotateSessionInput,
      tx: DbExecutor = db,
    ): Promise<SessionRecord | undefined> => {
      const [row] = await tx
        .update(sessions)
        .set({
          refreshTokenHash: input.refreshTokenHash,
          previousRefreshTokenHash: input.expectedRefreshTokenHash,
          refreshTokenExpiresAt: input.refreshTokenExpiresAt,
          rotatedAt: input.at,
          lastUsedAt: input.at,
          updatedAt: input.at,
        })
        .where(
          and(
            eq(sessions.id, input.id),
            eq(sessions.refreshTokenHash, input.expectedRefreshTokenHash),
            isNull(sessions.revokedAt),
          ),
        )
        .returning(recordColumns);

      return row;
    },

    /**
     * Revokes one session. Idempotent by the `revoked_at is null` guard: a
     * second logout leaves the original reason and timestamp intact, which is
     * what an audit trail wants.
     */
    revoke: async (input: RevokeInput, tx: DbExecutor = db): Promise<void> => {
      await tx
        .update(sessions)
        .set({
          revokedAt: input.at,
          revokedReason: input.reason,
          updatedAt: input.at,
        })
        .where(and(eq(sessions.id, input.id), isNull(sessions.revokedAt)));
    },

    /**
     * Revokes every live session of one principal — `logout-all`, the admin
     * forced logout, and the cascade that must run in the same transaction as
     * disabling an account (ADR-0018; `sessions` has no foreign key to either
     * population, so nothing else enforces it).
     *
     * @returns how many sessions were revoked.
     */
    revokeAllForPrincipal: async (
      input: RevokeAllInput,
      tx: DbExecutor = db,
    ): Promise<number> => {
      const revoked = await tx
        .update(sessions)
        .set({
          revokedAt: input.at,
          revokedReason: input.reason,
          updatedAt: input.at,
        })
        .where(
          and(
            eq(sessions.principalType, input.principalType),
            eq(sessions.principalId, input.principalId),
            isNull(sessions.revokedAt),
            ...(input.exceptSessionId === undefined
              ? []
              : [ne(sessions.id, input.exceptSessionId)]),
          ),
        )
        .returning({ id: sessions.id });

      return revoked.length;
    },

    /**
     * Revokes every live session **minted by impersonation on behalf of one
     * staff member** (ADR-0057 §6).
     *
     * The second revocation predicate, and it is a different question from the
     * one above: an impersonated row is `principal_type = 'user'` carrying the
     * customer's id, so `revokeAllForPrincipal({ principalType: "staff", … })`
     * — which is what every revocation path in the API calls — does not match
     * a single one of them. Without this, disabling an operator for cause left
     * them a full-access customer session, rotating happily, for the rest of
     * `IMPERSONATION_SESSION_TTL`.
     *
     * `impersonated_by_staff_id` is never null on a match, so no ordinary
     * session can be reached by this statement whatever is passed to it —
     * which is what keeps ADR-0018's behaviour identical outside the deltas.
     *
     * @returns the ended sessions, and not merely how many. Each one is an
     *   impersonation that ended, and ADR-0058's `impersonation.ended` names
     *   the customer it ended *on* — which is this row's `principal_id` and
     *   nothing the caller could have known.
     */
    revokeAllImpersonatedBy: async (
      input: RevokeAllImpersonatedByInput,
      tx: DbExecutor = db,
    ): Promise<readonly EndedImpersonation[]> => {
      const revoked = await tx
        .update(sessions)
        .set({
          revokedAt: input.at,
          revokedReason: input.reason,
          updatedAt: input.at,
        })
        .where(
          and(
            eq(sessions.impersonatedByStaffId, input.staffId),
            isNull(sessions.revokedAt),
          ),
        )
        .returning({ id: sessions.id, principalId: sessions.principalId });

      return revoked;
    },

    // `last_used_at` is written by `rotate` above and nowhere else: refresh is
    // the only event that touches it, because doing so per authenticated
    // request would turn a primary-key read into a write on the hottest path
    // the API has (ADR-0018, amended step 8).
    //
    // Retention is absent for a different reason: deleting dead sessions is a
    // tooling concern (`pnpm db:sessions:prune`, ADR-0018 §Cleanup) and lives
    // in `@repo/db`, so the retention rule has one implementation.
  }) as const;

export type SessionsRepository = ReturnType<typeof createSessionsRepository>;
