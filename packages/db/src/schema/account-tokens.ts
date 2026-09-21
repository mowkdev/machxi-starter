import { isNotNull } from "drizzle-orm";
import {
  index,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import {
  primaryId,
  principalTypeEnum,
  timestamps,
  tokenPurposeEnum,
} from "./_shared.js";

/**
 * The one token table behind every mail flow (ADR-0071 §1).
 *
 * Five flows — address verification, password reset, a change of address,
 * staff onboarding — share one mechanism rather than one table each: a
 * single-use token, hashed at rest, delivered in a link's fragment, and
 * consumed once inside the transaction that acts on it. `purpose`
 * discriminates them, and `payload` carries the one flow that needs more than
 * an identity (the new address, for `change_email`).
 *
 * The shape is `impersonation_handoffs`' (ADR-0057 §2) with a purpose column
 * and a principal discriminator, and it is that shape for the reason that
 * record gives: a credential that rides in a URL must be single-use with no
 * rotation grace, which is exactly what a refresh token is not.
 *
 * **No foreign keys**, the reasons `sessions` and `impersonation_handoffs`
 * each carry. Postgres cannot express "references staff or users depending on
 * a sibling column" (ADR-0018), staff are hard-deleted (ADR-0028), and a
 * consumed row is the record of a mint that happened. Every consume looks the
 * principal up itself, which is also the moment it re-checks that the account
 * is still one a token may act on.
 *
 * The organization invitation is **not** here: it keeps its own table and its
 * own `token_hash` because it carries organization state a generic row does
 * not (ADR-0067 §2, as ADR-0071 §1 inherits it).
 */
export const accountTokens = pgTable(
  "account_tokens",
  {
    id: primaryId(),
    purpose: tokenPurposeEnum().notNull(),
    /** The `sessions` discriminator shape (ADR-0017): staff or user. */
    principalType: principalTypeEnum().notNull(),
    principalId: uuid().notNull(),
    /**
     * SHA-256 of a `randomToken(32)`, base64url (`@repo/crypto`) — the storage
     * form of `sessions.refresh_token_hash` and
     * `impersonation_handoffs.token_hash`, and for the same reason: the token
     * is put in a link once and never stored, so a database read cannot yield
     * a usable credential.
     *
     * Unique, and named explicitly for the reason the other two name theirs —
     * an unnamed `.unique()` takes the TS property name and would put one
     * camelCase identifier in an otherwise snake_case database.
     */
    tokenHash: text().notNull().unique("account_tokens_token_hash_unique"),
    /**
     * Empty for every purpose but `change_email`, which carries the address
     * the confirmation will swap in (ADR-0071 §6).
     *
     * `jsonb` rather than a nullable `new_email text`: a column per flow is
     * how a shared table stops being one, and the value is written by the mint
     * and read by the consume in the same module. It is **redacted in logs**
     * (`payload`, `newEmail` in `defaultRedactPaths`, ADR-0005) because an
     * address in flight is exactly what a change-of-address flow must not
     * scatter through a log file.
     */
    payload: jsonb(),
    /** Now + the purpose's own TTL at the mint (ADR-0071 §1). */
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    /**
     * Set by the atomic consume (`update … where consumed_at is null
     * returning`), which is what makes a token strictly single-use: a replay
     * updates no row and is refused with nothing spent. A re-mint for the same
     * principal and purpose stamps the earlier row here too, so a person who
     * clicks "resend" holds one valid link rather than a growing set.
     */
    consumedAt: timestamp({ withTimezone: true }),
    /** The mint request's address and client, for the trail. `inet` as elsewhere. */
    ip: inet(),
    userAgent: text(),
    ...timestamps(),
  },
  (table) => [
    /*
     * The re-mint's lookup and the flow's own reads: "the live token of this
     * principal for this purpose". Leading with the principal rather than with
     * the purpose because the principal is the selective half — a deployment
     * has four purposes and as many principals as it has accounts.
     *
     * The token lookup itself is an equality on the hash, which `unique()`
     * above already indexes.
     */
    index("account_tokens_principal_purpose_idx").on(
      table.principalType,
      table.principalId,
      table.purpose,
    ),
    // For the sweep, which scans by expiry exactly as `db:sessions:prune`
    // already does over `sessions` and `impersonation_handoffs`
    // (ADR-0018 §Cleanup, ADR-0057 §2). ADR-0071 §1 decides that sweep grows
    // to delete consumed and expired token rows, and `pruneAccountTokens` in
    // `prune-sessions.ts` is it. The index lands with the table so the
    // migration never has to be reopened for it.
    index("account_tokens_expires_at_idx").on(table.expiresAt),
    // The sweep's other half (`D28.4`, `DB-07`), as on the two sibling
    // tables: without it `expires_at < cutoff OR consumed_at < cutoff` cannot
    // be a BitmapOr and every batch scans the table.
    index("account_tokens_consumed_at_idx")
      .on(table.consumedAt)
      .where(isNotNull(table.consumedAt)),
  ],
);
