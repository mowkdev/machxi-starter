import { createHash, timingSafeEqual } from "node:crypto";

import {
  emailSchema,
  nameSchema,
  type ErrorCode,
  type FederatedStartBody,
} from "@repo/contracts";
import type { DbExecutor } from "@repo/db";

import type { Audit } from "../../core/audit/index.js";
import type { RequestContext } from "../../core/context/index.js";
import {
  conflict,
  isAppError,
  unauthenticated,
  unavailable,
  type AppError,
} from "../../core/errors/index.js";
import {
  createAuthorizationRequest,
  type OidcAuthorizationRequest,
  type OidcIdentity,
  type OidcProvider,
  type OidcTransactionCodec,
} from "../../core/oidc/index.js";
import type { AccountTokens } from "../../core/tokens/index.js";
import type { OrganizationsService } from "../organizations/organizations.service.js";
import {
  accountDisabled,
  emailUnverified,
  federatedLinkRequired,
  federatedSignupClosed,
} from "./auth.errors.js";
import type {
  FederatedAccounts,
  PrincipalAdapter,
  PrincipalRecord,
} from "./auth.types.js";

/**
 * Sign in with Google — the start and the callback (ADR-0072 §1, §2).
 *
 * The third half, the exchange, is the auth service's (`exchangeFederated
 * Handoff`), because it issues a session and `sessions` is that service's
 * aggregate: this one proves who the provider vouched for, decides which
 * account that is, and leaves a sixty-second `federated_login` token for the
 * customer app to redeem — the impersonation handoff's shape, for its
 * reasons (ADR-0057 §2).
 *
 * **Every refusal is a value, not a throw**, at this service's edge. The
 * callback is a browser navigation from Google, and ADR-0072 §2 answers every
 * refusal on it as a `302` to the customer app with the code in the fragment;
 * an error the handler rendered would be JSON on a bare page. Inside, refusals
 * are thrown `AppError`s like everywhere else, because a refusal after a write
 * must roll the transaction back — and one catch at the end turns them into
 * the value. Anything that is not an `AppError` still propagates, so a real
 * fault reaches the error handler and the reporter rather than being folded
 * into a sentence.
 */

/** What the start hands the controller: where to send the browser, and the cookie. */
export interface FederatedStart {
  readonly authorizationUrl: string;
  /** The sealed transaction, for `__Host-<APP_ID>.oidc` and nowhere else. */
  readonly transaction: string;
}

export interface FederatedCallbackInput {
  readonly code: string | undefined;
  readonly state: string | undefined;
  /** The provider's `error` parameter — present when the person declined. */
  readonly error: string | undefined;
  /** The raw transaction cookie, as the browser presented it. */
  readonly transaction: string | undefined;
}

/**
 * The callback's answer, which the controller turns into one redirect: a
 * handoff token for `#token=`, or a code for `#error=` and nothing else in the
 * fragment (ADR-0072 §2).
 */
export type FederatedCallbackOutcome =
  | {
      readonly ok: true;
      readonly token: string;
      /**
       * The sealed handoff binding for the transaction cookie's place — the
       * token's hash, so only the browser the callback answered can exchange
       * it (ADR-0072 §2, amended at `D19.2`).
       */
      readonly binding: string;
    }
  | { readonly ok: false; readonly code: ErrorCode };

export interface FederatedSignInServiceDeps {
  /** ADR-0072 §2's port — the Google adapter, or the fake the suite hands the container. */
  readonly provider: OidcProvider;
  readonly transactions: OidcTransactionCodec;
  /** The user adapter narrowed to the address lookup the second rule reads. */
  readonly principals: Pick<PrincipalAdapter<"user">, "findByEmail">;
  readonly accounts: FederatedAccounts;
  /**
   * The third path that brings a user into existence (ADR-0067 §2), so the
   * personal organization lands in the same commit as the account.
   */
  readonly organizations: Pick<
    OrganizationsService,
    "ensurePersonalOrganizationFor"
  >;
  readonly accountTokens: AccountTokens;
  readonly audit: Audit;
  /**
   * `FEATURE_USER_REGISTRATION` (ADR-0004). It means "may new accounts be
   * made here", and ADR-0072 §1 reads it for the second door exactly as the
   * first reads it.
   */
  readonly registrationOpen: boolean;
  /**
   * `FEDERATED_HANDOFF_TTL` (ADR-0072 §2) — how long the handoff binding the
   * callback leaves in the cookie lives, which is the token's own window.
   */
  readonly handoffTtlSec: number;
  readonly transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  readonly now?: () => Date;
  /** Injected for the reason `newRefreshToken` is (ADR-0018 §Testability). */
  readonly newAuthorizationRequest?: () => OidcAuthorizationRequest;
}

/**
 * `state` against the cookie's copy, in constant time over equal-length
 * digests — the double-submit check's own comparison (`core/middleware/
 * csrf.ts`), for a value that binds a navigation to the browser that started
 * it.
 */
const sameValue = (a: string, b: string): boolean =>
  timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );

/**
 * The address the provider reported, normalised as every other address in
 * this API is — trimmed, lower-cased, bounded — or `undefined` when it is not
 * one `emailSchema` accepts. A registration and a sign-in with Google then
 * store the same string for the same mailbox.
 */
const normalisedEmail = (email: string | undefined): string | undefined => {
  const parsed = emailSchema.safeParse(email);

  return parsed.success ? parsed.data : undefined;
};

/** A provider name, held to `nameSchema`'s bounds, or dropped. */
const normalisedName = (name: string | undefined): string | undefined => {
  const parsed = nameSchema.safeParse(name);

  return parsed.success ? parsed.data : undefined;
};

export const createFederatedSignInService = ({
  provider,
  transactions,
  principals,
  accounts,
  organizations,
  accountTokens,
  audit,
  registrationOpen,
  handoffTtlSec,
  transaction,
  now = () => new Date(),
  newAuthorizationRequest = createAuthorizationRequest,
}: FederatedSignInServiceDeps) => {
  /**
   * One refusal, logged with its reason and never with the address: the
   * callback is anonymous until it resolves, and a log full of addresses with
   * outcomes is a list of who was probed.
   */
  const refuse = (
    ctx: RequestContext,
    error: AppError,
    reason: string,
  ): AppError => {
    ctx.logger.warn(
      { provider: provider.id, reason, code: error.code },
      "federated sign-in refused",
    );

    return error;
  };

  /** A refused account, in login's own words (ADR-0072 §1). */
  const inactive = (principal: PrincipalRecord): AppError =>
    principal.awaitingEmailVerification ? emailUnverified() : accountDisabled();

  /** The handoff, minted inside the transaction that decided who it is for. */
  const mintHandoff = async (
    ctx: RequestContext,
    userId: string,
    tx: DbExecutor,
  ): Promise<string> => {
    const { token } = await accountTokens.mint(
      ctx,
      { purpose: "federated_login", principal: { type: "user", id: userId } },
      tx,
    );

    return token;
  };

  /**
   * ADR-0072 §1's resolution, **in this order and no other**: by subject, by
   * address under four conditions, by creation behind the flag. Throws the
   * refusal, which rolls back anything this transaction wrote.
   */
  const resolve = async (
    ctx: RequestContext,
    identity: OidcIdentity,
    at: Date,
    tx: DbExecutor,
  ): Promise<string> => {
    // 1. By subject — whatever address either side carries today.
    const known = await accounts.findBySubject(
      provider.id,
      identity.subject,
      tx,
    );

    if (known !== undefined) {
      const { principal } = known;

      if (principal === undefined) {
        throw refuse(ctx, unauthenticated(), "identity names no live account");
      }

      if (!principal.active) {
        throw refuse(ctx, inactive(principal), "account is not active");
      }

      await accounts.touchLogin(known.identityId, at, tx);

      ctx.logger.info(
        { provider: provider.id, principalId: principal.id },
        "federated sign-in resolved by subject",
      );

      return mintHandoff(ctx, principal.id, tx);
    }

    // An unverified — or absent, or unusable — address never matches and
    // never creates. One answer whether or not an account holds it: the claim
    // proves nothing, so it may not learn anything either.
    const email = identity.emailVerified
      ? normalisedEmail(identity.email)
      : undefined;

    if (email === undefined) {
      throw refuse(ctx, unauthenticated(), "no verified address");
    }

    // A verified address the provider does not host proves that somebody
    // controlled the mailbox once, not that this person controls it now —
    // so it neither links nor creates (§1, amended at `D19.1` for linking and
    // at `D19.2` for creation, on that step's `security-reviewer`). Creating
    // on it would be the federated pre-hijack: the mailbox's previous holder
    // makes the account, the rightful owner later resets its password, and
    // the identity keeps the previous holder signing in by subject. Checked
    // before the address lookup, so the answer is the same whether or not an
    // account holds the address — no existence signal either way.
    if (!identity.emailAuthoritative) {
      throw refuse(ctx, federatedLinkRequired(), "address not authoritative");
    }

    // 2. By address — verified, the provider authoritative for it, a live
    // holder, and that holder `active` (§1, amended at `D19.1`).
    const holder = await principals.findByEmail(email, tx);

    if (holder !== undefined) {
      // A `pending_verification` holder's password belongs to whoever
      // registered the address — the pre-registration takeover ADR-0071
      // §Alternatives names — so nothing is linked and nothing is activated.
      if (!holder.active) {
        throw refuse(ctx, inactive(holder), "address holder is not active");
      }

      const linked = await accounts.link(
        {
          userId: holder.id,
          provider: provider.id,
          subject: identity.subject,
          email,
          at,
        },
        tx,
      );

      // The account already has another identity of this provider — a
      // different Google account for the same address. Not a thing to decide
      // on a sign-in's authority; the owner unlinks the old one first.
      if (!linked) {
        throw refuse(ctx, conflict(), "account already has an identity");
      }

      await audit.record(
        ctx,
        {
          event: "account.identity_linked",
          identities: { actor: { type: "user", id: holder.id } },
          data: { provider: provider.id, via: "address" },
        },
        tx,
      );

      ctx.logger.info(
        { provider: provider.id, principalId: holder.id },
        "federated identity linked by address",
      );

      return mintHandoff(ctx, holder.id, tx);
    }

    // 3. By creation — only where new accounts may be made at all.
    if (!registrationOpen) {
      throw refuse(ctx, federatedSignupClosed(), "registration is off");
    }

    const firstName = normalisedName(identity.givenName);
    const lastName = normalisedName(identity.familyName);

    const created = await accounts.createFederated(
      { email, firstName, lastName, at },
      tx,
    );

    // An account for the address committed between the read above and this
    // insert. Refused rather than retried: the next attempt resolves it.
    if (created === undefined) {
      throw refuse(ctx, conflict(), "address taken meanwhile");
    }

    await organizations.ensurePersonalOrganizationFor(
      ctx,
      {
        id: created.id,
        email: created.email,
        firstName: firstName ?? null,
        lastName: lastName ?? null,
      },
      tx,
    );

    if (
      !(await accounts.link(
        {
          userId: created.id,
          provider: provider.id,
          subject: identity.subject,
          email,
          at,
        },
        tx,
      ))
    ) {
      // The subject was linked by a concurrent callback since the first
      // read. The throw is what takes the account and its organization back
      // out with it.
      throw refuse(ctx, conflict(), "subject linked meanwhile");
    }

    // What a registration's trail holds once its address is proven —
    // `account.verified` — with the provider named, and the link beside it,
    // so "when did this Google account attach to this user" has a row
    // whichever path attached it (ADR-0072 §3's audit sentence, amended at
    // `D19.2`).
    await audit.record(
      ctx,
      {
        event: "account.verified",
        identities: { actor: { type: "user", id: created.id } },
        data: { provider: provider.id },
      },
      tx,
    );
    await audit.record(
      ctx,
      {
        event: "account.identity_linked",
        identities: { actor: { type: "user", id: created.id } },
        data: { provider: provider.id, via: "signup" },
      },
      tx,
    );

    ctx.logger.info(
      { provider: provider.id, principalId: created.id },
      "account created through a federated identity",
    );

    return mintHandoff(ctx, created.id, tx);
  };

  return {
    /** How long a started sign-in stays finishable — the cookie's `Max-Age`. */
    transactionTtlSec: transactions.ttlSec,

    /** How long the handoff binding lives in the cookie — the token's own window. */
    handoffTtlSec,

    /**
     * Whether the transaction cookie holds the binding the callback left for
     * exactly this token (ADR-0072 §2, amended at `D19.2`). The exchange asks
     * this **before** it spends anything, so a relayed token is refused by the
     * browser it was relayed to and stays redeemable, for its few seconds, in
     * the one it was minted for.
     */
    bindsHandoff: (cookie: string | undefined, token: string) =>
      transactions.bindsHandoff(cookie, token),

    /**
     * `POST /api/v1/public/auth/google/start` (ADR-0072 §2).
     *
     * A fresh `state`, `nonce` and PKCE verifier, sealed into the transaction
     * the controller puts in the cookie, and the provider's authorization URL
     * carrying their public halves. Rejects only when the provider's metadata
     * cannot be loaded — this is an XHR, and its caller can be told so.
     */
    start: async (
      ctx: RequestContext,
      { locale }: FederatedStartBody,
    ): Promise<FederatedStart> => {
      const request = newAuthorizationRequest();

      let authorizationUrl: string;

      try {
        authorizationUrl = await provider.authorizationUrl(ctx, request);
      } catch {
        ctx.logger.warn(
          { provider: provider.id },
          "federated sign-in could not start: provider metadata unavailable",
        );

        throw unavailable();
      }

      const sealed = await transactions.seal({
        ...request,
        intent: "signin",
        locale,
      });

      return { authorizationUrl, transaction: sealed };
    },

    /**
     * `GET /api/v1/public/auth/google/callback` (ADR-0072 §2).
     *
     * The cookie is read and **matched before anything is sent to the
     * provider**: a callback that does not carry this browser's `state` is one
     * somebody else started, which is the login-CSRF case the cookie exists to
     * close, and it costs Google nothing. The code is then redeemed with the
     * verifier the cookie carried, the ID token verified, and the account
     * resolved per §1 in one transaction with the handoff it mints.
     */
    callback: async (
      ctx: RequestContext,
      input: FederatedCallbackInput,
    ): Promise<FederatedCallbackOutcome> => {
      try {
        const opened = await transactions.open(input.transaction);

        if (opened === undefined) {
          throw refuse(ctx, unauthenticated(), "no transaction cookie");
        }

        if (input.error !== undefined) {
          throw refuse(ctx, unauthenticated(), "provider returned an error");
        }

        if (
          input.code === undefined ||
          input.state === undefined ||
          !sameValue(input.state, opened.state)
        ) {
          throw refuse(ctx, unauthenticated(), "state does not match");
        }

        const exchanged = await provider.exchangeCode(ctx, {
          code: input.code,
          codeVerifier: opened.codeVerifier,
          nonce: opened.nonce,
        });

        if (!exchanged.ok) {
          // The adapter has already logged the named reason; what the person
          // is told only separates "try again later" from "that did not work".
          throw exchanged.reason === "provider_unreachable"
            ? unavailable()
            : unauthenticated();
        }

        const at = now();
        const token = await transaction((tx) =>
          resolve(ctx, exchanged.identity, at, tx),
        );

        return {
          ok: true,
          token,
          binding: await transactions.sealHandoff(token, handoffTtlSec),
        };
      } catch (error) {
        if (isAppError(error) && error.code !== "INTERNAL_ERROR") {
          return { ok: false, code: error.code };
        }

        throw error;
      }
    },
  } as const;
};

export type FederatedSignInService = ReturnType<
  typeof createFederatedSignInService
>;
