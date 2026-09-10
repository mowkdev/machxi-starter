import type { Population, TokenPurpose } from "@repo/contracts";
import { randomToken, sha256Base64url } from "@repo/crypto";

import type { RequestContext } from "../context/index.js";
import type { DbExecutor } from "../db/index.js";
import type {
  AccountTokenRow,
  AccountTokensRepository,
} from "./tokens.repository.js";

/**
 * The one mint and the one consume behind every mail flow (ADR-0071 §1).
 *
 * Five flows — address verification, password reset, a change of address,
 * staff onboarding, and whatever the sixth turns out to be — share this rather
 * than each growing a token table, a hash, a TTL and an expiry check of its
 * own. What the shape guarantees, and what every flow above leans on:
 *
 * - the raw token exists **once**, in the return value of {@link
 *   AccountTokens.mint}; the database holds only its SHA-256, so a database
 *   read cannot yield a usable credential;
 * - a mint **supersedes** the live token of the same principal and purpose, so
 *   "resend" leaves one working link rather than a growing set;
 * - a consume is strictly single-use and happens **inside the caller's
 *   transaction**, so a refusal after the claim rolls the stamp back and a
 *   refused operation spends nothing.
 *
 * It is `core/` rather than a module for the audit writer's reason (ADR-0058):
 * the mechanism is infrastructure the features borrow, and the purposes belong
 * to the features. `ctx` comes first like every other dependency that takes it
 * (ADR-0010) — the request id on the log line is what ties a link somebody
 * received to the operation that sent it.
 */

/** Who a token is for: the `sessions` discriminator shape (ADR-0017). */
export interface TokenPrincipal {
  readonly type: Population;
  readonly id: string;
}

export interface MintAccountTokenInput {
  readonly purpose: TokenPurpose;
  readonly principal: TokenPrincipal;
  /**
   * The one flow that needs more than an identity: `change_email` carries the
   * address the confirmation will swap in (ADR-0071 §6). Redacted in logs
   * (`payload`, `newEmail` in `defaultRedactPaths`, ADR-0005).
   */
  readonly payload?: Record<string, unknown> | undefined;
}

/**
 * What a mint hands back. The token is here and nowhere else — not in the
 * database, not in a log line, not in the audit trail — so a caller that does
 * not put it in a link has lost it, which is the intended failure.
 */
export interface MintedAccountToken {
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * What a consume must state, and why it is three things rather than one.
 *
 * The token alone would be enough to find a row; the purpose and the
 * population are what stop one flow spending another's credential. Both are
 * matched inside the claiming statement rather than checked on the row it
 * returns — an atomic update that has already stamped a token has already
 * spent it (`D18.2`'s `security-reviewer`).
 */
export interface ConsumeTokenInput {
  readonly purpose: TokenPurpose;
  /** The population the consuming segment serves, which its router knows. */
  readonly principalType: Population;
  readonly token: string;
}

export interface AccountTokens {
  /**
   * Supersedes the live token for this principal and purpose, stores the hash
   * of a new one, and returns the raw token once.
   *
   * `tx` is optional and the absence is not a shortcut: without one the two
   * statements are wrapped in a transaction of this service's own, because a
   * supersession that commits without its replacement leaves a person holding
   * no working link at all. A caller that is already inside a transaction —
   * registration, which creates the account and its token together — passes
   * its executor so the account and the link live or die as one.
   */
  readonly mint: (
    ctx: RequestContext,
    input: MintAccountTokenInput,
    tx?: DbExecutor,
  ) => Promise<MintedAccountToken>;
  /**
   * Spends every live token of this principal and purpose **without minting a
   * replacement** (ADR-0071 §1, §6 as amended at `D18.9`).
   *
   * {@link AccountTokens.mint} already supersedes as a side effect, which
   * covers "the same person asked again". What this covers is the other case:
   * an operation that invalidates a link somebody else is holding. A password
   * change ends every other session because the account may be being recovered
   * from somebody — and a pending `change_email` link is a credential of
   * exactly that kind, mailed to an address the attacker chose, that the
   * session sweep cannot see (`D18.9`'s `security-reviewer`).
   *
   * `tx` is required: the whole value is that it lands in the same commit as
   * the operation that justifies it, so a rolled-back password change does not
   * leave a link destroyed.
   *
   * @returns how many live rows were stamped.
   */
  readonly supersede: (
    ctx: RequestContext,
    input: {
      readonly purpose: TokenPurpose;
      readonly principal: TokenPrincipal;
    },
    tx: DbExecutor,
  ) => Promise<number>;
  /**
   * Claims the token for this purpose and population, once.
   *
   * @returns the row, or `undefined` when the token is unknown, of another
   *   purpose, of the other population, already consumed or expired — five
   *   cases every caller must answer identically (ADR-0020 §Enumeration).
   */
  readonly consume: (
    ctx: RequestContext,
    input: ConsumeTokenInput,
    tx: DbExecutor,
  ) => Promise<AccountTokenRow | undefined>;
}

/**
 * The same 512 `sessions`, `audit_events` and `impersonation_handoffs` put on
 * the header, restated rather than imported for the reason `core/audit`
 * restates it: `core/` must not reach into `modules/` (ADR-0009). The header
 * is attacker-controlled and unbounded, and the address is `ctx.ip`, which the
 * context middleware has already refused to set unless `node:net` agrees it is
 * an IP — the `inet` column would otherwise turn a hostile header into a 500.
 */
export const MAX_TOKEN_USER_AGENT_LENGTH = 512;

export interface CreateAccountTokensDeps {
  readonly repository: AccountTokensRepository;
  /**
   * Every purpose's lifetime, in seconds, from `core/config` (ADR-0071 §1).
   *
   * A **total** record rather than a `ttl` on the mint call, and that is the
   * decision: the four windows answer four different questions and a caller
   * that passes its own could pass the verification link's day to a reset. An
   * exhaustive `Record<TokenPurpose, …>` also means a fifth purpose does not
   * compile until somebody decides how long its link should live.
   */
  readonly ttlSecByPurpose: Record<TokenPurpose, number>;
  /** The composition root's, so the mint's two statements can share one. */
  readonly transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  readonly now?: () => Date;
  /** Injected for the same reason `newRefreshToken` is (ADR-0018 §Testability). */
  readonly newToken?: () => string;
}

export const createAccountTokens = ({
  repository,
  ttlSecByPurpose,
  transaction,
  now = () => new Date(),
  newToken = () => randomToken(32),
}: CreateAccountTokensDeps): AccountTokens =>
  ({
    mint: async (ctx, { purpose, principal, payload }, tx) => {
      const at = now();
      const token = newToken();
      const expiresAt = new Date(
        at.getTime() + ttlSecByPurpose[purpose] * 1000,
      );

      const write = async (executor: DbExecutor) => {
        const pair = {
          purpose,
          principalType: principal.type,
          principalId: principal.id,
          at,
        } as const;

        // First, and for the length of this transaction: two overlapping mints
        // would otherwise each supersede what they can see, neither seeing the
        // other's uncommitted row, and both insert — "one working link" would
        // hold only when nobody double-clicks (`D18.2`'s `security-reviewer`).
        await repository.lockPrincipalPurpose(pair, executor);

        // Before the insert, inside the same transaction: there is no instant
        // in which two links for one purpose are redeemable, and no instant in
        // which none is (ADR-0071 §1).
        const superseded = await repository.supersedeLive(pair, executor);

        const row = await repository.insert(
          {
            purpose,
            principalType: principal.type,
            principalId: principal.id,
            tokenHash: sha256Base64url(token),
            payload,
            expiresAt,
            ip: ctx.ip,
            userAgent: ctx.userAgent?.slice(0, MAX_TOKEN_USER_AGENT_LENGTH),
          },
          executor,
        );

        return { row, superseded } as const;
      };

      const { row, superseded } =
        tx === undefined ? await transaction(write) : await write(tx);

      // Ids and counts, never the token and never the payload: this line is
      // the operational half of the flow — "a link was sent, and it replaced
      // one" — and a credential in it would be a credential in whatever ships
      // the logs (ADR-0005, ADR-0057 §2).
      //
      // Written inside a caller's transaction when one was passed, so a
      // rollback leaves a line describing a mint that did not commit. That is
      // deliberate and it is what every log line in this repository does: the
      // line records the *attempt*, the failure records itself through the
      // error handler, and the request id joins the two. A line deferred until
      // after a commit this service does not own would be a line that never
      // arrives when the commit fails, which is the worse trade.
      ctx.logger.info(
        {
          purpose,
          principalType: principal.type,
          principalId: principal.id,
          tokenId: row.id,
          superseded,
        },
        "account token minted",
      );

      return { token, expiresAt } as const;
    },

    supersede: async (ctx, { purpose, principal }, tx) => {
      const superseded = await repository.supersedeLive(
        {
          purpose,
          principalType: principal.type,
          principalId: principal.id,
          at: now(),
        },
        tx,
      );

      if (superseded > 0) {
        // Only when something was actually spent: a line on every password
        // change saying "no links destroyed" is noise, and the interesting
        // event — a link somebody was holding stopped working — is rare.
        ctx.logger.info(
          {
            purpose,
            principalType: principal.type,
            principalId: principal.id,
            superseded,
          },
          "account tokens superseded without replacement",
        );
      }

      return superseded;
    },

    consume: async (ctx, { purpose, principalType, token }, tx) => {
      const row = await repository.consume(
        {
          purpose,
          principalType,
          tokenHash: sha256Base64url(token),
          at: now(),
        },
        tx,
      );

      if (row === undefined) {
        // The purpose and nothing else. Every endpoint that consumes is
        // anonymous — the token *is* the credential — and a log full of
        // refused tokens with their principals is a list of who was targeted.
        // The request id correlates it (ADR-0057 §3's line, same argument).
        ctx.logger.warn(
          { purpose, principalType },
          "account token refused: none redeemable",
        );
      }

      return row;
    },
  }) as const;
