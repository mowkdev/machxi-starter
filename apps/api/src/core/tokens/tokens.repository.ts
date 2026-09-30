import type { Population, TokenPurpose } from "@repo/contracts";
import { accountTokens, type Db, type DbExecutor } from "@repo/db";
import { and, eq, gt, isNull, sql as raw } from "drizzle-orm";

import { internal } from "../errors/index.js";

/**
 * Every statement against `account_tokens` (ADR-0009, ADR-0071 §1).
 *
 * Four that act, and deliberately no more: the mint takes a lock on its principal and
 * purpose, stamps whatever was live for that pair, and inserts a row; the
 * consume claims one. There is **no `findByTokenHash`**, for the
 * reason `impersonation_handoffs` has none (ADR-0057 §2): a read followed by
 * an update is the shape that lets two concurrent redemptions of one token
 * both succeed, and "strictly single-use" would then be a property of how fast
 * an attacker can replay rather than a property of the database. The consume
 * is one `update … where consumed_at is null` whose `returning` is the read.
 *
 * {@link AccountTokensRepository.holderOf} is a read by the hash, and it is
 * not that shape: it answers **whom** a live token names so a caller can take
 * its locks in order before it claims (ADR-0078 §3), and it decides nothing —
 * the consume after it is still the one statement that spends the token.
 *
 * It sits in `core/` rather than in a feature module because the mechanism is
 * infrastructure five flows borrow — the audit writer's argument exactly
 * (ADR-0058): the *purposes* belong to the features, the token does not.
 */

/** What a mint stores. The token itself is never written anywhere. */
export interface NewAccountToken {
  readonly purpose: TokenPurpose;
  /** The `sessions` discriminator shape (ADR-0017): staff or user. */
  readonly principalType: Population;
  readonly principalId: string;
  /** SHA-256 of the opaque token, base64url (`@repo/crypto`). */
  readonly tokenHash: string;
  /** Empty for every purpose but `change_email` (ADR-0071 §6). */
  readonly payload?: Record<string, unknown> | undefined;
  /** Now + the purpose's own TTL, computed by the service. */
  readonly expiresAt: Date;
  readonly ip?: string | undefined;
  readonly userAgent?: string | undefined;
}

/**
 * What a caller learns from a row — never the hash, and never the expiry.
 *
 * The expiry is absent because it is already spent: the consume's `where`
 * refuses an expired row, so a caller that could read `expires_at` could only
 * use it to make the same decision a second time, less atomically.
 */
export interface AccountTokenRow {
  readonly id: string;
  readonly purpose: TokenPurpose;
  readonly principalType: Population;
  readonly principalId: string;
  readonly payload: Record<string, unknown> | null;
}

export interface ConsumeAccountTokenInput {
  /**
   * Matched in the `where`, not checked afterwards: a `verify_email` token
   * presented to the reset endpoint must find no row at all, so one flow can
   * never spend another's credential (ADR-0071 §1).
   */
  readonly purpose: TokenPurpose;
  /**
   * The **other half** of that sentence, and it is in the `where` for the same
   * reason (`D18.2`'s `security-reviewer`).
   *
   * `reset_password` is minted for both populations (ADR-0071 §4 puts the flow
   * on both segments), so a purpose alone leaves an operator's reset token
   * claimable at `/user/auth/password/reset` and a customer's at the admin
   * segment's. Checking `row.principalType` after the claim would be too late:
   * the update is atomic and would already have spent the token. A caller
   * passes the population its own segment serves, which every router knows
   * statically.
   */
  readonly principalType: Population;
  readonly tokenHash: string;
  /** The instant the consume is happening, for both the guard and the stamp. */
  readonly at: Date;
}

export interface SupersedeAccountTokensInput {
  readonly purpose: TokenPurpose;
  readonly principalType: Population;
  readonly principalId: string;
  readonly at: Date;
}

/** Whose credentials a lock serialises: the `sessions` discriminator shape. */
export interface CredentialHolder {
  readonly principalType: Population;
  readonly principalId: string;
}

export interface AccountTokensRepository {
  /**
   * Serialises the credential events of one principal against a flow that
   * must hold the account row before it claims a token, for the length of the
   * caller's transaction (ADR-0078 §3).
   *
   * A credential event sweeps the account's token rows and then locks the
   * account; the federated exchange locks the account and then claims its
   * handoff. Those two orders meet on the handoff's row, and this lock is what
   * keeps them from meeting half-way: both take it before either the account
   * row or the handoff, so the second to arrive waits holding nothing the
   * first needs. Keyed on the principal alone and apart from
   * {@link AccountTokensRepository.lockPrincipalPurpose}'s space by its
   * prefix.
   *
   * `tx` is required, for that lock's reason.
   */
  readonly lockCredentials: (
    holder: CredentialHolder,
    tx: DbExecutor,
  ) => Promise<void>;
  /**
   * Whom a live token of this purpose and population names, **without
   * claiming or locking it** — the principal to lock before the consume, and
   * nothing else. `undefined` for every case the consume would refuse.
   */
  readonly holderOf: (
    input: ConsumeAccountTokenInput,
    tx: DbExecutor,
  ) => Promise<CredentialHolder | undefined>;
  /**
   * Serialises concurrent mints for one principal and purpose, for the length
   * of the caller's transaction.
   *
   * Without it the supersession is not the guarantee ADR-0071 §1 says it is:
   * under `read committed` two overlapping mints each stamp what they can see
   * — neither sees the other's uncommitted row — and both insert, leaving the
   * person holding **two** redeemable links. A double-clicked "resend" is
   * enough. The lock is keyed on the pair, so it is contended only by a second
   * mint for the same person and purpose, which is exactly the case that has
   * to wait (`D18.2`'s `security-reviewer`).
   *
   * `tx` is required: `pg_advisory_xact_lock` is released at commit, so taken
   * outside a transaction it would be released before the statement it guards.
   */
  readonly lockPrincipalPurpose: (
    input: SupersedeAccountTokensInput,
    tx: DbExecutor,
  ) => Promise<void>;
  readonly insert: (
    row: NewAccountToken,
    tx?: DbExecutor,
  ) => Promise<AccountTokenRow>;
  /**
   * Claims a redeemable token, atomically.
   *
   * `tx` is **required**, unlike the two writes above: the whole discipline of
   * ADR-0071 §1 is that a token is spent inside the transaction that acts on
   * it, so a refusal downstream rolls the stamp back and nothing is spent. A
   * consume on its own connection could not offer that, and an optional
   * parameter is an invitation to find out.
   */
  readonly consume: (
    input: ConsumeAccountTokenInput,
    tx: DbExecutor,
  ) => Promise<AccountTokenRow | undefined>;
  /** @returns how many live rows were stamped — 0 or, in practice, 1. */
  readonly supersedeLive: (
    input: SupersedeAccountTokensInput,
    tx?: DbExecutor,
  ) => Promise<number>;
}

/** Selected by every statement, so no caller depends on a column by accident. */
const rowColumns = {
  id: accountTokens.id,
  purpose: accountTokens.purpose,
  principalType: accountTokens.principalType,
  principalId: accountTokens.principalId,
  payload: accountTokens.payload,
} as const;

/**
 * `jsonb` reads back as `unknown`, and it is narrowed here rather than by a
 * `$type<…>()` on the column: the table is shared by four purposes whose
 * payloads have nothing in common, so the honest type at the column is "some
 * JSON" and the flow that wrote it is the one that knows its shape. Anything
 * that is not an object — a bare string somebody stored, `null`, an array —
 * becomes `null`, so a caller never has to consider a third case.
 */
const toPayload = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const toRow = (row: {
  id: string;
  purpose: TokenPurpose;
  principalType: Population;
  principalId: string;
  payload: unknown;
}): AccountTokenRow => ({
  id: row.id,
  purpose: row.purpose,
  principalType: row.principalType,
  principalId: row.principalId,
  payload: toPayload(row.payload),
});

export const createAccountTokensRepository = (
  db: Db,
): AccountTokensRepository =>
  ({
    lockPrincipalPurpose: async (input, tx) => {
      // `hashtextextended` rather than a pair of 32-bit keys: the lock space is
      // one `bigint`, and the three values that identify the pair are hashed
      // into it as one string. A collision costs an unrelated mint a moment's
      // wait and nothing else, which is why a hash is an acceptable key here
      // and would not be for a uniqueness constraint.
      await tx.execute(
        raw`select pg_advisory_xact_lock(hashtextextended(${`${input.principalType}:${input.principalId}:${input.purpose}`}, 0))`,
      );
    },

    lockCredentials: async (holder, tx) => {
      // `lockPrincipalPurpose`'s key scheme, under a prefix of its own so the
      // two spaces cannot be mistaken for each other by construction; a hash
      // collision costs an unrelated request a moment's wait and nothing else.
      await tx.execute(
        raw`select pg_advisory_xact_lock(hashtextextended(${`credentials:${holder.principalType}:${holder.principalId}`}, 0))`,
      );
    },

    holderOf: async (input, tx) => {
      const [row] = await tx
        .select({
          principalType: accountTokens.principalType,
          principalId: accountTokens.principalId,
        })
        .from(accountTokens)
        .where(
          and(
            eq(accountTokens.tokenHash, input.tokenHash),
            eq(accountTokens.purpose, input.purpose),
            eq(accountTokens.principalType, input.principalType),
            isNull(accountTokens.consumedAt),
            gt(accountTokens.expiresAt, input.at),
          ),
        )
        .limit(1);

      return row;
    },

    insert: async (row, tx = db) => {
      const [created] = await tx
        .insert(accountTokens)
        .values({
          purpose: row.purpose,
          principalType: row.principalType,
          principalId: row.principalId,
          tokenHash: row.tokenHash,
          payload: row.payload ?? null,
          expiresAt: row.expiresAt,
          ip: row.ip ?? null,
          userAgent: row.userAgent ?? null,
        })
        .returning(rowColumns);

      if (created === undefined) {
        // Unreachable: a plain insert either returns its row or throws. Stated
        // rather than asserted so the type is honest without a non-null `!`
        // (the shape `sessions.create` and `handoffs.create` use, ADR-0013).
        throw internal(new Error("account_tokens.insert inserted no row"));
      }

      return toRow(created);
    },

    /**
     * The single-use guarantee, and it is entirely in the `where` clause:
     * `consumed_at is null` means exactly one of N concurrent redemptions of a
     * token updates a row and the rest see zero, and `expires_at > at` refuses
     * an expired one in the same statement rather than in a second read that
     * could race with it.
     *
     * An expired row is left **unconsumed** rather than stamped, as the
     * handoff's is: the sweep deletes it either way, and stamping it would
     * make `consumed_at` mean two different things.
     *
     * @returns the row, or `undefined` when the token is unknown, of another
     *   purpose, of the other population, already consumed, or past its expiry
     *   — cases the caller must answer identically, because telling them apart
     *   is an oracle (ADR-0020 §Enumeration).
     */
    consume: async (input, tx) => {
      const [row] = await tx
        .update(accountTokens)
        .set({ consumedAt: input.at, updatedAt: input.at })
        .where(
          and(
            eq(accountTokens.tokenHash, input.tokenHash),
            eq(accountTokens.purpose, input.purpose),
            eq(accountTokens.principalType, input.principalType),
            isNull(accountTokens.consumedAt),
            gt(accountTokens.expiresAt, input.at),
          ),
        )
        .returning(rowColumns);

      return row === undefined ? undefined : toRow(row);
    },

    /**
     * Stamps every live token of this principal for this purpose (ADR-0071
     * §1): a person who clicks "resend" holds **one** valid link, not a
     * growing set, and a stolen earlier link stops working the moment the
     * owner asks for another.
     *
     * Expired rows are excluded from the `where` for the reason the consume
     * excludes them — an expiry is not a consumption — so the count returned
     * is the number of links this mint actually invalidated.
     */
    supersedeLive: async (input, tx = db) => {
      const rows = await tx
        .update(accountTokens)
        .set({ consumedAt: input.at, updatedAt: input.at })
        .where(
          and(
            eq(accountTokens.principalType, input.principalType),
            eq(accountTokens.principalId, input.principalId),
            eq(accountTokens.purpose, input.purpose),
            isNull(accountTokens.consumedAt),
            gt(accountTokens.expiresAt, input.at),
          ),
        )
        .returning({ id: accountTokens.id });

      return rows.length;
    },

    // No delete: retention is `pnpm db:sessions:prune` (ADR-0071 §1), which
    // lives in `@repo/db` for the reason session retention does — the rule has
    // one implementation, and it is not on a request path.
  }) as const;
