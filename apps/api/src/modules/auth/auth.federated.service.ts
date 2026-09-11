import { createHash, timingSafeEqual } from "node:crypto";

import {
  emailSchema,
  nameSchema,
  type ErrorCode,
  type FederatedProvider,
  type FederatedStartBody,
} from "@repo/contracts";
import type { DbExecutor } from "@repo/db";

import { requirePopulation } from "../../core/auth/index.js";
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
  type OidcTransaction,
  type OidcTransactionCodec,
} from "../../core/oidc/index.js";
import type { AccountTokens } from "../../core/tokens/index.js";
import type { OrganizationsService } from "../organizations/organizations.service.js";
import {
  accountDisabled,
  emailUnverified,
  federatedLinkRequired,
  federatedSignupClosed,
  identityTaken,
} from "./auth.errors.js";
import type { SessionsRepository } from "./auth.repository.js";
import type {
  FederatedAccounts,
  PrincipalAdapter,
  PrincipalRecord,
} from "./auth.types.js";

/**
 * Sign in with Google — the start and the callback (ADR-0072 §1, §2) — and,
 * since `D19.4`, the link: an authenticated start whose callback attaches the
 * identity to the account that asked (§3).
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
      readonly kind: "signin";
      readonly token: string;
      /**
       * The sealed handoff binding for the transaction cookie's place — the
       * token's hash, so only the browser the callback answered can exchange
       * it (ADR-0072 §2, amended at `D19.2`).
       */
      readonly binding: string;
    }
  | {
      /**
       * A link completed (ADR-0072 §3): `#linked=<provider>`, and no token —
       * the browser that asked already holds the session it asked from.
       */
      readonly ok: true;
      readonly kind: "linked";
      readonly provider: FederatedProvider;
    }
  | { readonly ok: false; readonly code: ErrorCode };

export interface FederatedSignInServiceDeps {
  /** ADR-0072 §2's port — the Google adapter, or the fake the suite hands the container. */
  readonly provider: OidcProvider;
  readonly transactions: OidcTransactionCodec;
  /**
   * The user adapter narrowed to the address lookup the second rule reads,
   * and the account read a link re-checks at the callback.
   */
  readonly principals: Pick<
    PrincipalAdapter<"user">,
    "findByEmail" | "findById"
  >;
  /**
   * The sessions table narrowed to one probe, for the link's callback
   * (ADR-0072 §3, amended at `D19.4`): the identity joins the account only
   * while the session that asked for it is still live.
   */
  readonly sessions: Pick<SessionsRepository, "findById">;
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
  sessions,
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

      // The account row's lock, then proof the identity is still there
      // (`D19.5`'s `security-reviewer`; ADR-0072 §3, amended after `D19.4`).
      // A reset that committed after the read above removed it, and a
      // handoff minted anyway would be a session the recovery did not see;
      // a reset that starts after this lock waits for this commit and then
      // supersedes the handoff it mints. Refused as a sign-in that did not
      // work — the next attempt resolves afresh.
      await accounts.lockAccount(principal.id, tx);

      if (!(await accounts.touchLogin(known.identityId, at, tx))) {
        throw refuse(ctx, unauthenticated(), "identity removed meanwhile");
      }

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

    // 2. By address — verified, the provider authoritative for it, a live
    // holder, and that holder `active` (§1, amended at `D19.1`).
    const holder = await principals.findByEmail(email, tx);

    if (holder !== undefined) {
      // A verified address the provider does not host proves that somebody
      // controlled the mailbox once, not that this person controls it now, so
      // it does not attach to an account that already exists — whatever that
      // account's status (§1, amended at `D19.1`). The person signs in with
      // the password and links from the security section, which proves both
      // sides at once.
      //
      // **Only here**, and no longer at the head of the resolution: `D19.2`
      // made creation read authority too, and the operator withdrew that at
      // `D19.4` (§1's last amendment), because a reset now removes every
      // identity (§3) — so an account made on a mailbox whose previous holder
      // made it is recovered by the mailbox, as a pre-registered password
      // account is.
      if (!identity.emailAuthoritative) {
        throw refuse(
          ctx,
          federatedLinkRequired(),
          "address not authoritative for its holder",
        );
      }

      // A `pending_verification` holder's password belongs to whoever
      // registered the address — the pre-registration takeover ADR-0071
      // §Alternatives names — so nothing is linked and nothing is activated.
      if (!holder.active) {
        throw refuse(ctx, inactive(holder), "address holder is not active");
      }

      // The link callback's lock, for its reason (§3, amended after
      // `D19.4`): this inserts an identity into an existing account, and a
      // reset of that account must see it or come after it — never between.
      await accounts.lockAccount(holder.id, tx);

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

    // 3. By creation — only where new accounts may be made at all, and on a
    // verified claim whether or not the provider hosts the mailbox (§1, the
    // `D19.2` narrowing withdrawn at `D19.4`).
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

  /**
   * ADR-0072 §3's link, at the callback: the identity joins the account the
   * transaction names, **only while the session that asked is still live**,
   * and only when no other account signs in with it.
   *
   * The session check is the amendment `D19.4` made to §3. The transaction
   * lives ten minutes and carries the account's id sealed, so without it a
   * link started from a session that has since been ended — by a password
   * reset recovering the account from somebody, which removes every identity
   * (§3's reset rule) — would attach a way in *after* the recovery, from the
   * very session the recovery ended. A session impersonation minted is
   * refused here too, beside the start's route guard (ADR-0057 §5).
   *
   * The address the provider reports is informational and need not match the
   * account's: the person has proven control of both sides (§3).
   */
  const linkTo = async (
    ctx: RequestContext,
    identity: OidcIdentity,
    asked: Extract<OidcTransaction, { intent: "link" }>,
    at: Date,
    tx: DbExecutor,
  ): Promise<void> => {
    const { userId, sessionId } = asked;

    // **The account row's lock first** (§3, amended after `D19.4`; built at
    // `D19.5`), before the session is read. A reset of this account holds the
    // same lock from before it removes the identities until it commits, so
    // this either runs wholly before it — and the reset sees, and removes,
    // what is linked here — or wholly after, when the session read below
    // finds the reset's revocation. Without it the two interleave: the session
    // reads live, the reset commits, and the insert lands after the removal.
    await accounts.lockAccount(userId, tx);

    const session = await sessions.findById(sessionId, tx);

    if (
      session === undefined ||
      session.principalType !== "user" ||
      session.principalId !== userId ||
      session.revokedAt !== null ||
      session.refreshTokenExpiresAt.getTime() <= at.getTime() ||
      session.impersonatedByStaffId !== null
    ) {
      throw refuse(ctx, unauthenticated(), "the linking session is not live");
    }

    const account = await principals.findById(userId, tx);

    if (account === undefined || !account.active) {
      throw refuse(ctx, unauthenticated(), "the linking account is not active");
    }

    const known = await accounts.findBySubject(
      provider.id,
      identity.subject,
      tx,
    );

    if (known !== undefined) {
      // Already this account's: the honest answer is that it is linked, and
      // there is nothing to write or to record twice.
      if (known.principal?.id === userId) return;

      throw refuse(ctx, identityTaken(), "subject linked to another account");
    }

    const linked = await accounts.link(
      {
        userId,
        provider: provider.id,
        subject: identity.subject,
        email: normalisedEmail(identity.email) ?? null,
        at,
      },
      tx,
    );

    // The account already holds a *different* identity of this provider, or
    // the subject was linked by a concurrent callback since the read above.
    // The owner unlinks the old one first; nothing is swapped on a link's
    // authority.
    if (!linked) {
      throw refuse(ctx, conflict(), "account already has an identity");
    }

    await audit.record(
      ctx,
      {
        event: "account.identity_linked",
        identities: { actor: { type: "user", id: userId } },
        data: { provider: provider.id, via: "link" },
      },
      tx,
    );

    ctx.logger.info(
      { provider: provider.id, principalId: userId },
      "federated identity linked from the account",
    );
  };

  /**
   * A fresh `state`, `nonce` and PKCE verifier, sealed with what the callback
   * must know about the attempt, and the provider's authorization URL carrying
   * their public halves. Rejects only when the provider's metadata cannot be
   * loaded — both starts are XHRs, and their caller can be told so.
   */
  const begin = async (
    ctx: RequestContext,
    seal: (request: OidcAuthorizationRequest) => OidcTransaction,
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

    return {
      authorizationUrl,
      transaction: await transactions.seal(seal(request)),
    };
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

    /** `POST /api/v1/public/auth/google/start` (ADR-0072 §2). */
    start: (
      ctx: RequestContext,
      { locale }: FederatedStartBody,
    ): Promise<FederatedStart> =>
      begin(ctx, (request) => ({ ...request, intent: "signin", locale })),

    /**
     * `POST /api/v1/user/profile/identities/google/start` (ADR-0072 §3).
     *
     * The sign-in's start, with the caller's account and session sealed into
     * the transaction beside the intent. The route is behind `authenticate`
     * and `refuseImpersonated`, so the principal here is an account acting as
     * itself.
     */
    startLink: (
      ctx: RequestContext,
      { locale }: FederatedStartBody,
    ): Promise<FederatedStart> => {
      const principal = requirePopulation(ctx, "user");

      return begin(ctx, (request) => ({
        ...request,
        intent: "link",
        userId: principal.id,
        sessionId: principal.sessionId,
        locale,
      }));
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

        if (opened.intent === "link") {
          await transaction((tx) =>
            linkTo(ctx, exchanged.identity, opened, at, tx),
          );

          return { ok: true, kind: "linked", provider: provider.id };
        }

        const token = await transaction((tx) =>
          resolve(ctx, exchanged.identity, at, tx),
        );

        return {
          ok: true,
          kind: "signin",
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
