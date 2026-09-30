import {
  TOKEN_PURPOSES,
  type Population,
  type TokenPurpose,
} from "@repo/contracts";
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
   * Spends every live token of this principal, **of every purpose**, without
   * minting a replacement (ADR-0074 §5, the delta on ADR-0071 §6 and §7).
   *
   * The one function every credential event calls — an administrative or
   * staff reset, a password change, an administrative address change, an
   * account deletion — so the rule "a credential event spends every link" has
   * one name rather than a loop copied into each service, where the fourth
   * copy was the one left short (`API-09`, `DB-11`). Iterated over
   * `TOKEN_PURPOSES`, so a purpose is covered on the day it is declared; one
   * that should survive a credential event has to say so there, which is the
   * safe direction for an omission to point.
   *
   * **Where a caller puts it is the caller's lock order.** Every consume
   * claims its token row and then writes the account, so a caller that also
   * locks the account row calls this first where it can; the one purpose
   * minted *behind* the account's lock — the federated handoff — is swept
   * again after it by the flows that take that lock.
   *
   * **It takes the principal's credential lock** (ADR-0078 §3), after the
   * `reset_password` rows and before every other: the federated exchange takes
   * the same lock before the account row and its handoff
   * ({@link AccountTokens.lockHolderOf}), so a sweep and an exchange of one
   * account take turns instead of each holding what the other waits for. After
   * `reset_password`, because the reset by mail arrives here already holding
   * the row it claimed, and a second sweep of the account must queue on that
   * row holding nothing — `SWEEP_ORDER`'s reason, which the lock must not undo.
   *
   * `tx` is required, for {@link AccountTokens.supersede}'s reason.
   *
   * @returns how many live rows were stamped, across every purpose.
   */
  readonly supersedeAll: (
    ctx: RequestContext,
    principal: TokenPrincipal,
    tx: DbExecutor,
  ) => Promise<number>;
  /**
   * Takes this principal's credential lock for the rest of the caller's
   * transaction (ADR-0078 §3) — the lock {@link AccountTokens.supersedeAll}
   * takes, for a flow that goes on to lock the account row and then touch its
   * handoff rows: the Google callback, which mints behind that row.
   */
  readonly lockCredentials: (
    principal: TokenPrincipal,
    tx: DbExecutor,
  ) => Promise<void>;
  /**
   * Takes the credential lock of the principal a live token names, **without
   * claiming the token**, and says who that is (ADR-0078 §3).
   *
   * For a consume that must hold the account row before it claims — the
   * federated exchange, whose handoff is minted behind that row's lock and
   * swept again behind it by a credential event. The caller takes this, then
   * the account row, then {@link AccountTokens.consume}: the order a credential
   * event reaches the handoff in, with {@link AccountTokens.supersedeAll}'s
   * lock at the head of both. `undefined` — and no lock — for every token the
   * consume would refuse; the caller still consumes, and is refused there.
   */
  readonly lockHolderOf: (
    ctx: RequestContext,
    input: ConsumeTokenInput,
    tx: DbExecutor,
  ) => Promise<TokenPrincipal | undefined>;
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

/**
 * The order {@link AccountTokens.supersedeAll} sweeps in: every purpose, with
 * `reset_password` **first**. The reset by mail sweeps while already holding
 * the `reset_password` row it claimed, so any other sweep of the same account
 * must queue on that row before it locks anything else — otherwise it could
 * stamp a `verify_email` row the reset then waits on, while waiting on the
 * reset's row itself (`D28.5`'s `security-reviewer`).
 */
const SWEEP_ORDER: readonly TokenPurpose[] = [
  "reset_password",
  ...TOKEN_PURPOSES.filter((purpose) => purpose !== "reset_password"),
];

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

    supersedeAll: async (ctx, principal, tx) => {
      const at = now();
      let superseded = 0;

      // One statement per purpose rather than one without a purpose filter:
      // it is the statement the mint and `supersede` already run, so there is
      // one supersession in the repository and not two. Sequential, on one
      // executor — a transaction is one connection.
      for (const [index, purpose] of SWEEP_ORDER.entries()) {
        // The credential lock after the first purpose — see the interface.
        if (index === 1) {
          await repository.lockCredentials(
            { principalType: principal.type, principalId: principal.id },
            tx,
          );
        }

        superseded += await repository.supersedeLive(
          {
            purpose,
            principalType: principal.type,
            principalId: principal.id,
            at,
          },
          tx,
        );
      }

      if (superseded > 0) {
        // One line for the event rather than one per purpose, and only when
        // something was spent — `supersede`'s reason.
        ctx.logger.info(
          {
            principalType: principal.type,
            principalId: principal.id,
            superseded,
          },
          "every account token superseded without replacement",
        );
      }

      return superseded;
    },

    lockCredentials: (principal, tx) =>
      repository.lockCredentials(
        { principalType: principal.type, principalId: principal.id },
        tx,
      ),

    lockHolderOf: async (_ctx, { purpose, principalType, token }, tx) => {
      const holder = await repository.holderOf(
        {
          purpose,
          principalType,
          tokenHash: sha256Base64url(token),
          at: now(),
        },
        tx,
      );

      if (holder === undefined) return undefined;

      await repository.lockCredentials(holder, tx);

      return { type: holder.principalType, id: holder.principalId } as const;
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
