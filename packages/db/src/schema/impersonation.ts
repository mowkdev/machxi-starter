import { isNotNull } from "drizzle-orm";
import {
  index,
  inet,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { primaryId, timestamps } from "./_shared.js";

/**
 * The one-time handoff a staff member exchanges for an impersonated session
 * (ADR-0057 §2).
 *
 * The mint (`POST /admin/users/:id/impersonate`) writes a row and returns the
 * token; the exchange (`POST /user/auth/impersonate`) consumes it. Between the
 * two the credential travels through a URL fragment, which is why this is a
 * dedicated artefact rather than the session's refresh token: ADR-0018's
 * rotation grace deliberately tolerates a replayed refresh for
 * `REFRESH_ROTATION_GRACE_SEC`, and a credential that rides in a URL must have
 * no grace window at all.
 *
 * **No foreign keys**, the reason `sessions.impersonated_by_staff_id` carries
 * and one more besides: staff are hard-deleted (ADR-0028), and a consumed row
 * is a record of a mint that happened. Nothing here is loaded by joining to a
 * live account — the exchange reads `staff_id` and `user_id` and looks each up
 * itself, which is also the moment it re-checks that the target is still
 * active.
 */
export const impersonationHandoffs = pgTable(
  "impersonation_handoffs",
  {
    id: primaryId(),
    /**
     * SHA-256 of the opaque token, base64url (`@repo/crypto`), as on
     * `sessions.refresh_token_hash`: the token is returned to the minting
     * staff member once and never stored, so a database read cannot yield a
     * usable credential.
     *
     * Unique, and named explicitly for the reason `sessions` names its own —
     * an unnamed `.unique()` takes the TS property name and would put one
     * camelCase identifier in an otherwise snake_case database.
     */
    tokenHash: text()
      .notNull()
      .unique("impersonation_handoffs_token_hash_unique"),
    /** The staff member who minted it. Becomes the session's actor column. */
    staffId: uuid().notNull(),
    /** The customer account it opens. */
    userId: uuid().notNull(),
    /** Now + `IMPERSONATION_HANDOFF_TTL` at the mint; 60 seconds by default. */
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    /**
     * Set by the atomic consume (`update … where consumed_at is null
     * returning`), which is what makes the token strictly single-use: a replay
     * inside any window updates no row and is answered `401` with nothing
     * minted.
     */
    consumedAt: timestamp({ withTimezone: true }),
    /** The mint request's address and client, for the trail. `inet` as elsewhere. */
    ip: inet(),
    userAgent: text(),
    ...timestamps(),
  },
  (table) => [
    // For the sweep, which scans by expiry exactly as `db:sessions:prune`
    // already does over `sessions` (ADR-0018 §Cleanup). ADR-0057 §2 decides
    // that sweep grows to delete consumed and expired handoffs, and since
    // `D13.4` it has: `pruneImpersonationHandoffs` in `prune-sessions.ts` runs
    // beside `pruneSessions` on the same cutoff. The index landed with the
    // table so the migration would not have to be reopened for it. The token
    // lookup itself is an equality on the hash, which `unique()` above already
    // indexes.
    index("impersonation_handoffs_expires_at_idx").on(table.expiresAt),
    // The sweep's other half (`D28.4`, `DB-07`): an `OR` is served by a
    // BitmapOr only when both sides are indexed. Partial, because an
    // unconsumed row is null here and never the consumed half's concern.
    index("impersonation_handoffs_consumed_at_idx")
      .on(table.consumedAt)
      .where(isNotNull(table.consumedAt)),
  ],
);
