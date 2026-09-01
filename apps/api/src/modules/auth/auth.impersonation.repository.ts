import { impersonationHandoffs, type DbExecutor } from "@repo/db";
import { and, eq, gt, isNull } from "drizzle-orm";

import { internal } from "../../core/errors/index.js";

/**
 * Every query against `impersonation_handoffs` (ADR-0009, ADR-0057 §2).
 *
 * Two statements and no more: the mint inserts a row, the exchange consumes
 * one. There is deliberately no plain `findByTokenHash` — a read followed by
 * an update is the shape that lets two concurrent exchanges of the same token
 * both succeed, and "strictly single-use" would then be a property of how fast
 * an attacker can replay rather than a property of the database. The consume
 * is one `update … where consumed_at is null` and its `returning` is the read.
 *
 * It sits in the auth module because a handoff is an authentication credential
 * exchanged for a session: the aggregate it belongs to is `sessions`, and both
 * halves of the flow are written by this module (ADR-0009 — the module is the
 * feature, not the URL).
 */

/** What the mint stores. The token itself is never written anywhere. */
export interface NewHandoffInput {
  /** SHA-256 of the opaque token, base64url (`@repo/crypto`). */
  readonly tokenHash: string;
  readonly staffId: string;
  readonly userId: string;
  /** Now + `IMPERSONATION_HANDOFF_TTL`, computed by the service. */
  readonly expiresAt: Date;
  readonly ip?: string | undefined;
  readonly userAgent?: string | undefined;
}

/** What the exchange learns by consuming a row. */
export interface ConsumedHandoff {
  readonly id: string;
  readonly staffId: string;
  readonly userId: string;
}

export interface ConsumeHandoffInput {
  readonly tokenHash: string;
  /** The instant the exchange is happening, for both the guard and the stamp. */
  readonly at: Date;
}

/** Selected by both statements, so no caller can depend on a column by accident. */
const recordColumns = {
  id: impersonationHandoffs.id,
  staffId: impersonationHandoffs.staffId,
  userId: impersonationHandoffs.userId,
} as const;

export const createHandoffsRepository = (db: DbExecutor) =>
  ({
    create: async (
      input: NewHandoffInput,
      tx: DbExecutor = db,
    ): Promise<ConsumedHandoff> => {
      const [created] = await tx
        .insert(impersonationHandoffs)
        .values({
          tokenHash: input.tokenHash,
          staffId: input.staffId,
          userId: input.userId,
          expiresAt: input.expiresAt,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        })
        .returning(recordColumns);

      if (created === undefined) {
        // Unreachable: a plain insert either returns its row or throws. Stated
        // rather than asserted so the type is honest without a non-null `!`
        // (the shape `sessions.create` uses, ADR-0013).
        throw internal(
          new Error("impersonation_handoffs.create inserted no row"),
        );
      }

      return created;
    },

    /**
     * Claims a redeemable handoff, atomically (ADR-0057 §2).
     *
     * The whole single-use guarantee is in the `where` clause: `consumed_at is
     * null` means exactly one of N concurrent exchanges of the same token
     * updates a row and the rest see zero, and `expires_at > at` means an
     * expired token is refused by the same statement rather than by a second
     * read that could race with it. This is why the handoff is a dedicated
     * artefact rather than the session's refresh token — ADR-0018's rotation
     * grace deliberately tolerates a replay for 30 seconds, and a credential
     * that travels through a URL must have no grace window at all.
     *
     * An expired row is left **unconsumed** rather than stamped: the sweep
     * (`pruneImpersonationHandoffs`) deletes it either way, and stamping it
     * would make `consumed_at` mean two different things.
     *
     * The guarantee this buys is precisely **at most one session per handoff**,
     * which is narrower than "one attempt". The exchange runs this inside its
     * transaction, so a refusal *after* the claim — the target went inactive,
     * the minting staff member is gone — rolls the stamp back and the row is
     * redeemable again for the rest of its `IMPERSONATION_HANDOFF_TTL`. That is
     * the right way round: nothing was minted, so nothing was spent, and the
     * bound is the sixty-second window rather than the check that failed
     * (ADR-0057 §2, amended `D13.4`).
     *
     * @returns the row's identities, or `undefined` when the token is unknown,
     *   already consumed, or past its expiry — three cases the caller must
     *   answer identically.
     */
    consume: async (
      input: ConsumeHandoffInput,
      tx: DbExecutor = db,
    ): Promise<ConsumedHandoff | undefined> => {
      const [row] = await tx
        .update(impersonationHandoffs)
        .set({ consumedAt: input.at, updatedAt: input.at })
        .where(
          and(
            eq(impersonationHandoffs.tokenHash, input.tokenHash),
            isNull(impersonationHandoffs.consumedAt),
            gt(impersonationHandoffs.expiresAt, input.at),
          ),
        )
        .returning(recordColumns);

      return row;
    },

    // No delete: retention is `pnpm db:sessions:prune` (ADR-0057 §2), which
    // lives in `@repo/db` for the reason session retention does — the rule has
    // one implementation, and it is not on a request path.
  }) as const;

export type HandoffsRepository = ReturnType<typeof createHandoffsRepository>;
