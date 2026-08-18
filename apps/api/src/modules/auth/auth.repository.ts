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
}

export interface NewSessionInput {
  readonly principalType: Population;
  readonly principalId: string;
  readonly refreshTokenHash: string;
  readonly refreshTokenExpiresAt: Date;
  readonly ip?: string | undefined;
  readonly userAgent?: string | undefined;
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
