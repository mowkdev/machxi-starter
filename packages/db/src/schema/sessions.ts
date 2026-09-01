import {
  index,
  inet,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { primaryId, principalTypeEnum, timestamps } from "./_shared.js";

/**
 * One row per login on one device (ADR-0018).
 *
 * A single table serves both populations, discriminated by `principal_type`.
 * There is deliberately **no foreign key** on `principal_id`: Postgres cannot
 * express "references staff or users depending on a sibling column", and the
 * alternatives (two nullable FKs, or a table per population) trade a real
 * constraint for either a check constraint of the same strength or duplicated
 * rotation logic. Deleting a principal therefore leaves its sessions behind —
 * the service revokes them in the same transaction (ADR-0018 §Admin forced
 * logout), and an orphan is unusable anyway because the principal lookup that
 * follows session verification fails.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: primaryId(),
    principalType: principalTypeEnum().notNull(),
    principalId: uuid().notNull(),
    /**
     * SHA-256 of the opaque refresh token, base64url (`@repo/crypto`). The
     * token itself is sent to the client once and never stored, so a database
     * read cannot yield a usable credential.
     */
    // Named explicitly: an unnamed `.unique()` takes the TS property name, and
    // `sessions_refreshTokenHash_unique` would be the one camelCase identifier
    // in an otherwise snake_case database.
    refreshTokenHash: text()
      .notNull()
      .unique("sessions_refresh_token_hash_unique"),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }).notNull(),
    /**
     * The hash rotated out on the last refresh. Two jobs: it lets a client
     * that lost the response retry inside `REFRESH_ROTATION_GRACE_SEC`, and
     * outside that window a hit here is **reuse detection** — the session is
     * revoked with `revoked_reason = 'refresh_reuse'`.
     */
    previousRefreshTokenHash: text(),
    rotatedAt: timestamp({ withTimezone: true }),
    /** Audit trail; `inet` so a v6 address needs no widening later. */
    ip: inet(),
    userAgent: text(),
    lastUsedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp({ withTimezone: true }),
    /** Free text (`logout`, `logout_all`, `refresh_reuse`, `admin_revoke`, `account_disabled`, `impersonation_ended`). */
    revokedReason: text(),
    /**
     * The staff member acting **as** this session's principal, when the session
     * was minted by impersonation rather than by a password (ADR-0057 §4).
     *
     * Null on every ordinary session, and the column is what makes an
     * impersonated one different: `authenticate` reads it into
     * `ctx.principal.impersonatedBy`, refresh declines to extend the session's
     * end while it is set, and the exclusion middleware keys on it.
     *
     * **Deliberately no foreign key**, and for a stronger reason than the one
     * `principal_id` carries above: staff are *hard*-deleted (ADR-0028), so a
     * reference would either block the deletion or take the attribution with
     * it — and attribution that disappears when its actor leaves is not
     * attribution. The same reasoning `audit_events` is built on (ADR-0058).
     */
    impersonatedByStaffId: uuid(),
    ...timestamps(),
  },
  (table) => [
    // "Every session of this principal" — logout-all, admin forced logout, and
    // the account-disabled cascade.
    index("sessions_principal_idx").on(table.principalType, table.principalId),
    // The refresh lookup is an equality on the current hash; `unique()` above
    // already indexes it. The previous hash needs its own index because the
    // reuse check is a second equality on a different column.
    index("sessions_previous_refresh_token_hash_idx").on(
      table.previousRefreshTokenHash,
    ),
    // The prune job (`db:sessions:prune`, ADR-0018 §Cleanup) scans by expiry.
    index("sessions_refresh_token_expires_at_idx").on(
      table.refreshTokenExpiresAt,
    ),
  ],
);
