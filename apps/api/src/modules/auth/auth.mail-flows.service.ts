import type {
  AcceptOnboardingBody,
  ConfirmEmailBody,
  FederatedProvider,
  ForgotPasswordBody,
  RegisterBody,
  ResendVerificationBody,
  ResetPasswordBody,
  VerifyEmailBody,
} from "@repo/contracts";
import type { DbExecutor } from "@repo/db";

import type { RequestContext } from "../../core/context/index.js";
import { internal } from "../../core/errors/index.js";
import { createMailDelivery, localeFor } from "../../core/mail/index.js";
import {
  emailChangeLinkInvalid,
  onboardingLinkInvalid,
  passwordResetLinkInvalid,
  registrationConflict,
  verificationLinkInvalid,
} from "./auth.errors.js";
// The one error this module raises that belongs to another aggregate's
// vocabulary (ADR-0013): `USER_EMAIL_TAKEN` is the users module's code, and
// `confirm-email` is the second endpoint that can raise it. Imported rather
// than restated, because two factories for one code is how one sentence
// becomes two — the mirror of `currentPasswordInvalid`, which lives in this
// module and is imported by the users one.
import { userEmailTaken } from "../users/users.errors.js";
import type { IssuedAuthResource } from "./auth.mapper.js";
import type { AuthSessions } from "./auth.sessions.service.js";
import {
  REVOKE_REASONS,
  readEmailChangePayload,
  readResetRequest,
  type ResetRequest,
  type ResolvedAuthDeps,
} from "./auth.types.js";

/**
 * The flows that begin or end in a mailbox (ADR-0071): registration and the
 * verification link, the staff onboarding accept, the address change's
 * anonymous half, and the password recovery pair.
 *
 * Split out of `auth.service.ts` at `D20.7` with no change of behaviour.
 * `createAuthService` composes it into the object it returns, so nothing
 * outside this module can tell that `register` and `login` no longer live in
 * one file — which is the point: what these seven share is a mailed token
 * (ADR-0071 §1), and what they need from the session half is exactly the two
 * functions below.
 */
export type AuthMailFlowsDeps = ResolvedAuthDeps & {
  /**
   * The session mint, from {@link createAuthSessions} (ADR-0018).
   *
   * Passed in rather than rebuilt: three of these flows end in a session —
   * verification, the onboarding accept — and every property the mint decides
   * (the fixed impersonated end, the per-principal cap, the `act` claim) has
   * to be decided in one place or it is decided twice.
   */
  readonly issueSession: AuthSessions["issueSession"];
  /**
   * The revoke-all sweep, from {@link createAuthSessions} (ADR-0057 §6).
   *
   * `resetPassword` is one of its callers, and it is the one that must reach
   * the impersonated rows the principal predicate cannot see.
   */
  readonly revokeEverySessionOf: AuthSessions["revokeEverySessionOf"];
};

export const createAuthMailFlows = ({
  population,
  principals,
  sessions,
  audit,
  hasher,
  hashLimiter,
  organizations,
  federated,
  accountTokens,
  mail,
  mailTemplates,
  transaction,
  now,
  issueSession,
  revokeEverySessionOf,
}: AuthMailFlowsDeps) => {
  /**
   * What a consumed reset link removes of the account's federated identities
   * (ADR-0072 §3 as amended after `D19.4`), on the reset's own executor.
   *
   * - **The mailbox asked** (`forgot`): every identity — the reset recovers
   *   the account from every way in.
   * - **A session asked** (the set-password link): only the identities linked
   *   **later than that session's `created_at`**. The row is read revoked or
   *   not — a revoked session still says when it began — and it must be this
   *   account's session of this population; a row that is gone, or names
   *   somebody else, keeps nothing.
   *
   * Only the user service holds the seam; without it — the staff service —
   * there is nothing to remove.
   */
  const removeIdentitiesFor = async (
    principalId: string,
    request: ResetRequest,
    tx: DbExecutor,
  ): Promise<readonly FederatedProvider[]> => {
    if (federated === undefined) return [];

    if (request.requestedBy === "mailbox") {
      return federated.unlinkAll(principalId, tx);
    }

    const asking =
      request.sessionId === undefined
        ? undefined
        : await sessions.findStartedAt(request.sessionId, tx);

    return asking === undefined ||
      asking.principalType !== population ||
      asking.principalId !== principalId
      ? federated.unlinkAll(principalId, tx)
      : federated.unlinkLinkedAfter(principalId, asking.createdAt, tx);
  };

  /**
   * The two sends, from `core/mail` (ADR-0066 §1).
   *
   * They were this service's own until `D18.7` made the invitation the third
   * flow that sends; what they decide — a failed delivery never fails the
   * request, the driver's message never reaches a log line, and the endpoints
   * that answer the same thing whatever they find do not await a relay — is a
   * property of sending mail here rather than of these flows, so it lives
   * beside the port.
   */
  const { deliver, deliverDetached } = createMailDelivery({ mail });

  /**
   * Mints a `verify_email` token for an account and mails the link
   * (ADR-0071 §3).
   *
   * Written once because registration and `resend-verification` are the same
   * two statements in a different order, and the mint **supersedes** the live
   * token for the pair — so however many times a person presses resend, one
   * link works (ADR-0071 §1).
   *
   * `tx` is the caller's when there is one: registration mints inside the
   * transaction that created the account, so an account with no link and a
   * link with no account are both unreachable. The send is never inside it —
   * see the ordering at the call site.
   */
  const mintVerificationLink = async (
    ctx: RequestContext,
    principalId: string,
    tx?: DbExecutor,
  ): Promise<string> => {
    const { token } = await accountTokens.mint(
      ctx,
      {
        purpose: "verify_email",
        principal: { type: population, id: principalId },
      },
      tx,
    );

    return token;
  };

  return {
    /**
     * `POST /api/v1/public/auth/register` (ADR-0018 §Staff onboarding, as
     * ADR-0071 §3 supersedes its answer).
     *
     * **Creates a `pending_verification` account, mails the link, and issues
     * no session.** The delta on ADR-0018 is exactly that: registration used
     * to answer `201` with login's body, and a client held a session for an
     * address nobody had proven. From here the link is what signs the device
     * in, and the invariant it buys — every `active` user has a proven
     * address — is what ADR-0067 §5's address-match acceptance and D19's
     * linking rule are allowed to lean on.
     *
     * Available on the user service only — the staff adapter has no `create`,
     * because staff cannot self-register.
     */
    register: async (
      ctx: RequestContext,
      body: RegisterBody,
    ): Promise<void> => {
      const create = principals.create;

      if (create === undefined) {
        // A wiring mistake — the public router mounts this from the user
        // service — so it is a 500, not a 403: no client can cause it.
        throw internal(
          new Error(`population "${population}" has no self-registration path`),
        );
      }

      if (organizations === undefined) {
        // The same class of wiring mistake, and refused as loudly: a
        // population that can self-register must be able to create the
        // personal organization in the same transaction (ADR-0067 §2). Serving
        // the request without one would leave an account that every
        // organization-scoped query has no branch for — the failure this
        // check exists to make impossible rather than rare.
        throw internal(
          new Error(`population "${population}" has no organizations service`),
        );
      }

      const passwordHash = await hashLimiter.run(() =>
        hasher.hash(body.password),
      );

      const created = await transaction(async (tx) => {
        const account = await create(
          {
            email: body.email,
            passwordHash,
            firstName: body.firstName,
            lastName: body.lastName,
          },
          tx,
        );

        if (account === undefined) return undefined;

        // In the transaction that inserted the account, before anything is
        // mailed: the new principal's first request must already find its
        // organization there (ADR-0067 §2). The name columns come from the
        // body rather than from `account.resource`, which is the union of both
        // populations' resources here — same two values, no narrowing, and
        // the derivation itself lives in `@repo/db` beside the one the
        // backfill migration wrote in SQL.
        await organizations.ensurePersonalOrganizationFor(
          ctx,
          {
            id: account.id,
            email: account.email,
            firstName: body.firstName ?? null,
            lastName: body.lastName ?? null,
          },
          tx,
        );

        // The token joins the same commit, so there is no interval in which an
        // account exists with no way to prove its address (ADR-0071 §1).
        const token = await mintVerificationLink(ctx, account.id, tx);

        return { id: account.id, email: account.email, token } as const;
      });

      if (created === undefined) {
        // Generic conflict, and logged without the address: naming it would
        // turn an anonymous endpoint into an account-existence oracle
        // (ADR-0020 §Enumeration).
        ctx.logger.warn({ population }, "registration rejected as a duplicate");

        throw registrationConflict();
      }

      // **After the commit**, deliberately. A message sent from inside the
      // transaction is a message that arrives for an account that was rolled
      // back — and the link in it would name a token row that does not exist,
      // which is the one failure a person cannot recover from on their own.
      await deliver(
        ctx,
        created.email,
        { population, purpose: "verify_email" },
        mailTemplates.verifyEmail({
          token: created.token,
          locale: localeFor(body.locale),
        }),
      );

      ctx.logger.info(
        { population, principalId: created.id },
        "account registered, awaiting address confirmation",
      );
    },

    /**
     * `POST /api/v1/public/auth/verify-email` (ADR-0071 §3).
     *
     * The link's whole effect, in one transaction: claim the token, move the
     * account to `active` with its address stamped proven, write the audit
     * row, and issue the session — the device that opened the mail is the
     * device that has just proven the mailbox, so it is signed in exactly as
     * the impersonation exchange signs one in.
     *
     * **Every refusal rolls the claim back.** The consume, the activation and
     * the audit row share one transaction, so a token presented for an account
     * that is deleted, disabled or already active is refused with nothing
     * spent — the link still works if the account becomes eligible again — and
     * a replay of a *successful* verification is refused because the row is
     * stamped (ADR-0071 §1).
     */
    verifyEmail: async (
      ctx: RequestContext,
      { token }: VerifyEmailBody,
    ): Promise<IssuedAuthResource> => {
      const activate = principals.activateVerified;

      if (activate === undefined) {
        // The same wiring refusal `register` makes, and for its reason: the
        // route is mounted from the user service, and a staff twin would be a
        // way to activate an operator from a URL fragment.
        throw internal(
          new Error(`population "${population}" has no verification path`),
        );
      }

      const at = now();

      return transaction(async (tx) => {
        const claimed = await accountTokens.consume(
          ctx,
          { purpose: "verify_email", principalType: population, token },
          tx,
        );

        if (claimed === undefined) throw verificationLinkInvalid();

        const principal = await activate(claimed.principalId, at, tx);

        // The token was live but the account is not one a link may act on any
        // more — deleted, disabled, or verified by another route meanwhile.
        // One answer with the unknown-token case, and the throw is what undoes
        // the claim.
        if (principal === undefined) {
          ctx.logger.warn(
            { population, tokenId: claimed.id },
            "verification refused: the account cannot be activated",
          );

          throw verificationLinkInvalid();
        }

        // `identities` rather than the context's principal: the route is
        // anonymous — the token is the credential — so the actor comes off the
        // row that was claimed (ADR-0058, the exchange's shape).
        await audit.record(
          ctx,
          {
            event: "account.verified",
            identities: { actor: { type: population, id: principal.id } },
          },
          tx,
        );

        const auth = await issueSession(ctx, principal, at, tx);

        await principals.touchLastLogin(principal.id, at, tx);

        ctx.logger.info(
          { population, principalId: principal.id },
          "address confirmed and the device signed in",
        );

        return auth;
      });
    },

    /**
     * `POST /api/v1/admin/auth/onboarding/accept` (ADR-0071 §8).
     *
     * The staff twin of `verifyEmail`, and the differences are §8's rather
     * than this file's. A customer proves a mailbox and already has the
     * password they chose at registration; an operator's address was asserted
     * by whoever created the row (§3) and what they lack is a **credential**,
     * so the link carries a password with it and the account moves out of
     * `invited` rather than out of `pending_verification`.
     *
     * What is the same, and deliberately so: the link's whole effect is one
     * transaction — claim the token, write the first hash with the status,
     * record it, mint the session — and **every refusal rolls the claim
     * back**, so a token naming a row an admin has disabled since the message
     * went out is refused with nothing spent and works again if the account is
     * re-enabled. A replay of a *successful* accept is refused twice over: the
     * token row is stamped, and the row it names has left `invited`.
     *
     * **The device is signed in**, exactly as verification signs one in and
     * unlike the password reset of §4, which deliberately does not. The
     * difference is what the two links prove. A reset link proves a mailbox
     * for an account that already has a password somebody may be holding, so
     * §4 revokes every session and hands out none; this link is the *only*
     * way this account has ever been reachable, there are no sessions to
     * revoke, and the person at the other end has just chosen the credential —
     * making them sign in again would be asking them to prove, one second
     * later, the thing they have this moment created.
     *
     * The hash is computed **before** the transaction opens, for
     * `resetPassword`'s reason: ~130 ms of a libuv thread is not something to
     * hold a claimed token row across. The price is that a refused token still
     * buys a hash, which is what the route's own budget is for.
     */
    acceptOnboarding: async (
      ctx: RequestContext,
      { token, password }: AcceptOnboardingBody,
    ): Promise<IssuedAuthResource> => {
      const activate = principals.activateOnboarded;

      if (activate === undefined) {
        // The wiring refusal `register` and `verifyEmail` make, and for their
        // reason read the other way round: the route is registered on the
        // admin segment alone, and a user-segment twin would be a way to
        // activate a customer account from a link nobody minted for one.
        throw internal(
          new Error(`population "${population}" has no onboarding path`),
        );
      }

      const at = now();
      const passwordHash = await hashLimiter.run(() => hasher.hash(password));

      return transaction(async (tx) => {
        const claimed = await accountTokens.consume(
          ctx,
          { purpose: "staff_onboarding", principalType: population, token },
          tx,
        );

        if (claimed === undefined) throw onboardingLinkInvalid();

        const principal = await activate(
          claimed.principalId,
          passwordHash,
          at,
          tx,
        );

        // The token was live but the row is not one this link may act on any
        // more — deleted, disabled, or onboarded by a second tab a moment
        // ago. One answer with the unknown-token case, and the throw is what
        // undoes the claim.
        if (principal === undefined) {
          ctx.logger.warn(
            { population, tokenId: claimed.id },
            "onboarding refused: the account cannot be activated",
          );

          throw onboardingLinkInvalid();
        }

        // `identities` rather than the context's principal: the route is
        // anonymous — the token is the credential — so the actor comes off the
        // row that was claimed (ADR-0058, `account.verified`'s shape). This is
        // the staff population's only self-service lifecycle event, and it is
        // the one moment an operator account becomes able to sign in, so it
        // belongs in the trail beside the address change that can move it.
        await audit.record(
          ctx,
          {
            event: "account.onboarded",
            identities: { actor: { type: population, id: principal.id } },
          },
          tx,
        );

        const auth = await issueSession(ctx, principal, at, tx);

        await principals.touchLastLogin(principal.id, at, tx);

        ctx.logger.info(
          { population, principalId: principal.id },
          "onboarding accepted and the device signed in",
        );

        return auth;
      });
    },

    /**
     * `POST /api/v1/public/auth/confirm-email` (ADR-0071 §6) — the half of
     * the address change that actually changes an address.
     *
     * The request half lives in the users module, where the profile is: it
     * verifies the current password, refuses a taken address and mails the new
     * mailbox a link. **Nothing has moved by then.** This is what moves it,
     * and it moves it for whoever holds the link — anonymous, because the new
     * mailbox is very often not the one holding a session.
     *
     * The whole effect is one transaction: claim the token, read the account
     * to learn the address it is leaving, ask the uniqueness question **again**
     * (an hour may have passed, and the answer is not a fact the token can
     * carry), write the new address with `email_verified_at` stamped, and
     * record it. Every refusal rolls the claim back, so a link refused because
     * the account was disabled for an afternoon still works when it is not.
     *
     * **No session is issued and none is revoked**, which is §6's decision
     * rather than an omission: an address is not a credential, and the person
     * signed in on another device did not stop being that person. What the
     * change *is* worth is the sentence the notice below carries — it
     * redirects every future recovery link — and it is why the request half is
     * refused under impersonation (ADR-0057 §5).
     *
     * **The old address is notified afterwards, plainly and with no link.** It
     * is the only warning the previous mailbox gets, and a link in it would be
     * a credential mailed to an address the account no longer belongs to.
     */
    confirmEmailChange: async (
      ctx: RequestContext,
      { token }: ConfirmEmailBody,
    ): Promise<void> => {
      const changeEmail = principals.changeEmailVerified;
      const isTaken = principals.isEmailTaken;

      if (changeEmail === undefined || isTaken === undefined) {
        // `register`'s and `verifyEmail`'s wiring refusal, for their reason:
        // the route is mounted from the user service, and a staff twin would
        // be a way to move an operator's address from a URL fragment.
        throw internal(
          new Error(`population "${population}" has no address-change path`),
        );
      }

      const at = now();

      const changed = await transaction(async (tx) => {
        const claimed = await accountTokens.consume(
          ctx,
          { purpose: "change_email", principalType: population, token },
          tx,
        );

        if (claimed === undefined) throw emailChangeLinkInvalid();

        const requested = readEmailChangePayload(claimed.payload);

        if (requested === undefined) {
          // Unreachable through the API — the mint writes the address — and
          // refused as a dead link rather than as a `500`, because the only
          // caller who could ever see it is holding a URL fragment and has
          // nothing to do about it either way.
          ctx.logger.error(
            { population, tokenId: claimed.id },
            "address change refused: the token carries no address",
          );

          throw emailChangeLinkInvalid();
        }

        // Read before the write, for the address being left: it is where the
        // notice goes, and after the update the row no longer holds it.
        const principal = await principals.findById(claimed.principalId, tx);

        if (principal === undefined) throw emailChangeLinkInvalid();

        // Asked again, inside the transaction, because the request half asked
        // it up to `EMAIL_CHANGE_TOKEN_TTL` ago. This `409` is the one refusal
        // on the endpoint that is not the indistinguishable `401`: whoever
        // holds the link already knows which address it names — it is the
        // mailbox the message arrived in — so there is no existence left to
        // conceal, and it is the only failure here that a different address
        // would fix.
        if (await isTaken(requested.newEmail, tx)) throw userEmailTaken();

        const updated = await changeEmail(
          principal.id,
          requested.newEmail,
          at,
          tx,
        );

        // The token was live but the account is not one a link may act on any
        // more — deleted, disabled, or beaten to the address by a change that
        // committed between the check above and this statement. One answer
        // with the unknown-token case, and the throw is what undoes the claim.
        if (updated === undefined) {
          ctx.logger.warn(
            { population, tokenId: claimed.id },
            "address change refused: the account cannot be changed",
          );

          throw emailChangeLinkInvalid();
        }

        // `identities` rather than the context's principal: the route is
        // anonymous — the token is the credential — so the actor comes off
        // the row that was claimed (ADR-0058, verification's shape). Both
        // addresses are on the row because ADR-0071 §7 requires the trail to
        // name them; an address is a fact about the account rather than a
        // credential, and without the old one the row cannot answer "where did
        // this account's mail used to go".
        await audit.record(
          ctx,
          {
            event: "account.email_changed",
            identities: { actor: { type: population, id: principal.id } },
            data: {
              previousEmail: principal.email,
              newEmail: requested.newEmail,
            },
          },
          tx,
        );

        return {
          principalId: principal.id,
          previousEmail: principal.email,
          newEmail: requested.newEmail,
          locale: requested.locale,
        } as const;
      });

      // **After the commit**, for `register`'s reason: a notice sent from
      // inside the transaction is a notice about a change that was rolled
      // back. Detached, because nothing in the answer reports delivery and
      // somebody is waiting on a screen (`core/mail/delivery.ts`).
      deliverDetached(
        ctx,
        changed.previousEmail,
        { population, purpose: "change_email" },
        mailTemplates.emailChanged({
          locale: changed.locale,
          newEmail: changed.newEmail,
        }),
      );

      ctx.logger.info(
        { population, principalId: changed.principalId },
        "address changed from a mailed link",
      );
    },

    /**
     * `POST /api/v1/{admin,user}/auth/password/forgot` (ADR-0071 §4).
     *
     * **Always resolves**, exactly as `resendVerification` does and for the
     * identical reason: an unknown address, an active account, a
     * `pending_verification` one, a disabled one and a deleted one are one
     * answer — `202` — because anything that differed between them would make
     * an anonymous endpoint an account-existence oracle (ADR-0020
     * §Enumeration). The only observable difference is a message in a mailbox
     * the caller has to already own.
     *
     * `findActiveByEmail` is what decides who is mailed, and its narrowness is
     * the decision rather than an optimisation: a `pending_verification` row
     * has never proven its address, so a recovery link sent to it would be a
     * credential mailed to a mailbox nobody has confirmed — the one flow that
     * could reach that row is the verification link itself.
     *
     * The mint supersedes the live token for the pair (ADR-0071 §1), so the
     * third request in a row leaves one working link rather than three, and
     * the two limiters on the route bound how many messages the mailbox
     * receives — one per sender, one for the mailbox itself (§4, amended at
     * `D18.5`).
     */
    requestPasswordReset: async (
      ctx: RequestContext,
      { email, locale }: ForgotPasswordBody,
    ): Promise<void> => {
      const account = await principals.findActiveByEmail(email);

      if (account === undefined) {
        // No address on the line, for the reason the failed-login line carries
        // none: this endpoint is anonymous, and a log full of addresses is a
        // list of who was probed, with a timestamp.
        ctx.logger.info(
          { population },
          "password reset answered without a message",
        );

        return;
      }

      const { token } = await accountTokens.mint(ctx, {
        purpose: "reset_password",
        principal: { type: population, id: account.id },
      });

      deliverDetached(
        ctx,
        account.email,
        { population, purpose: "reset_password" },
        mailTemplates.passwordReset({
          token,
          locale: localeFor(locale),
          // The link has to land on the app this account signs into, and the
          // segment is what knows which (ADR-0071 §2): a staff member sent to
          // the customer app would arrive at a screen that cannot help them.
          population,
        }),
      );

      ctx.logger.info(
        { population, principalId: account.id },
        "password reset link sent",
      );
    },

    /**
     * `POST /api/v1/{admin,user}/auth/password/reset` (ADR-0071 §4).
     *
     * The link's whole effect, in one transaction: claim the token, write the
     * new hash, **remove every federated identity** — or, when a session asked
     * for the link, every one younger than that session (ADR-0072 §3, amended
     * at `D19.4` and after it) — under the account row's lock, record it, and
     * **revoke every session of the account** — the person may well be
     * recovering it from somebody, and a reset that left the thief's session
     * or the thief's Google account in place would be a reset in name only.
     *
     * **No session is issued**, and that is the decision ADR-0071 §4 states
     * against the common shortcut: the link proved the mailbox, not the
     * device. Signing in is one step away and it is the step that proves the
     * password just chosen actually works.
     *
     * **Every refusal rolls the claim back**, as verification's does: a token
     * naming an account that has been disabled or deleted since the mint is
     * refused with nothing spent, so the link still works if the account
     * becomes eligible again.
     *
     * The hash is computed **before** the transaction opens. It costs ~130 ms
     * of a libuv thread (ADR-0020 §Hashing cost vs. liveness), and holding a
     * claimed token row locked for that long would serialise every reset
     * behind the slowest one; the price is that a refused token still buys a
     * hash, which is why the route carries the login limiter — the same
     * limiter, for the same argon2 reason, that `register` shares.
     */
    resetPassword: async (
      ctx: RequestContext,
      { token, newPassword }: ResetPasswordBody,
    ): Promise<void> => {
      const at = now();
      const passwordHash = await hashLimiter.run(() =>
        hasher.hash(newPassword),
      );

      const reset = await transaction(async (tx) => {
        const claimed = await accountTokens.consume(
          ctx,
          { purpose: "reset_password", principalType: population, token },
          tx,
        );

        if (claimed === undefined) throw passwordResetLinkInvalid();

        // In the same commit as the new hash, beside the session sweep below
        // and for its reason (`D18.9`'s `security-reviewer`): a pending
        // `change_email` link is a credential the account did not choose,
        // mailed to an address somebody else typed, and the session sweep
        // cannot see it. Recovery is the flow a person reaches when the
        // account is already in somebody else's hands, so a link that outlived
        // it would hand the account back an hour later. **Every** outstanding
        // link since ADR-0074 §5 — a reset is a credential event, and a second
        // `reset_password` link or an onboarding one is the same way back in.
        //
        // **Before the account row's lock** (`D19.5`'s `security-reviewer`):
        // every consume claims its token row and then writes the account, so
        // a reset that held the account and then reached for those rows would
        // be the other half of a deadlock. Token rows first, then the account
        // — a consume's order. The one this request claimed above is already
        // stamped, so the sweep does not count it.
        await accountTokens.supersedeAll(
          ctx,
          { type: population, id: claimed.principalId },
          tx,
        );

        // **The account row's lock, before anything is read or written**
        // (ADR-0072 §3, amended after `D19.4`): a link callback for this
        // account either committed before this point — and its identity is
        // seen, and removed, below — or waits for this commit and then finds
        // its session revoked. Users only; staff hold no identities.
        if (federated !== undefined) {
          await federated.lockAccount(claimed.principalId, tx);
        }

        const principal = await principals.findById(claimed.principalId, tx);

        // The token was live but the account is not one a link may act on any
        // more — deleted, disabled, or moved out of `active` meanwhile. One
        // answer with the unknown-token case, and the throw is what undoes the
        // claim.
        if (principal === undefined || !principal.active) {
          ctx.logger.warn(
            { population, tokenId: claimed.id },
            "password reset refused: the account cannot be reset",
          );

          throw passwordResetLinkInvalid();
        }

        await principals.updatePasswordHash(principal.id, passwordHash, at, tx);

        // **Every federated identity goes with the old password** (ADR-0072
        // §3, amended — the delta on ADR-0071 §4 built at `D19.4`), for the
        // reason the session sweep below exists: the account may be being
        // recovered from somebody, and a Google account attached to it is a
        // way in that sweep cannot see. One row each, the provider named and
        // the subject never.
        //
        // **A session-minted link keeps only what is older than the session
        // that asked** (§3, amended after `D19.4`; built at `D19.5`). The
        // session asked and the mailbox confirmed — but a session can be in
        // the wrong hands, link its holder's own Google account, and ask; the
        // owner who follows the mail to secure the account must not be the
        // click that keeps the intruder's way in. A stolen cookie is the
        // owner's own session, opened before anything the intruder linked, so
        // whatever is younger than it goes; a session row that is gone — or a
        // payload naming none — keeps nothing.
        const request = readResetRequest(claimed.payload);
        const removed = await removeIdentitiesFor(principal.id, request, tx);

        for (const provider of removed) {
          await audit.record(
            ctx,
            {
              event: "account.identity_unlinked",
              identities: { actor: { type: population, id: principal.id } },
              data: { provider, via: "reset" },
            },
            tx,
          );
        }

        // **A Google handoff minted before this commit dies with it**
        // (`D19.5`'s `security-reviewer`): a sixty-second `federated_login`
        // token is a session not yet issued, and the sweep below cannot see
        // one that has not been exchanged. Swept again here although the
        // sweep above covered the purpose: the callback mints behind the
        // account row's lock — account, then its handoff — so one minted
        // while this request waited for that lock is only visible after it.
        await accountTokens.supersede(
          ctx,
          {
            purpose: "federated_login",
            principal: { type: population, id: principal.id },
          },
          tx,
        );

        // `identities` rather than the context's principal: the route is
        // anonymous — the token is the credential — so the actor comes off the
        // row that was claimed (ADR-0058, verification's shape). The data says
        // which kind of reset it was and what it removed (ADR-0072 §3,
        // amended after `D19.4`): a mailbox recovery and a session's own
        // set-password link are one template and one consume, and only this
        // row tells them apart afterwards. Providers, never subjects.
        await audit.record(
          ctx,
          {
            event: "account.password_reset",
            identities: { actor: { type: population, id: principal.id } },
            data: { requestedBy: request.requestedBy, unlinked: removed },
          },
          tx,
        );

        // In the same transaction as the write, with no exception for any
        // device: `revokeSessionsFor`'s administrative twin spares nobody
        // either, and here the account holder has proven a mailbox rather than
        // a session.
        const ended = await revokeEverySessionOf(
          ctx,
          {
            principalId: principal.id,
            reason: REVOKE_REASONS.passwordReset,
            at,
          },
          tx,
        );

        return {
          principalId: principal.id,
          revoked: ended.revoked,
          unlinked: removed.length,
        } as const;
      });

      ctx.logger.info(
        { population, ...reset },
        "password reset from a mailed link",
      );
    },
    /**
     * `POST /api/v1/public/auth/resend-verification` (ADR-0071 §3).
     *
     * **Always resolves.** An unknown address, a live account, a disabled one
     * and a deleted one are one answer — `202` — because anything that
     * differed between them would make an anonymous endpoint an
     * account-existence oracle (ADR-0020 §Enumeration). The only observable
     * difference is a message in a mailbox the caller has to already own.
     *
     * The mint supersedes the live token, so a person who presses the button
     * five times holds one working link rather than five (ADR-0071 §1) — and
     * the limiter on the route bounds how many messages the mailbox receives
     * (§4's budget, in a counter of its own).
     */
    resendVerification: async (
      ctx: RequestContext,
      { email, locale }: ResendVerificationBody,
    ): Promise<void> => {
      const find = principals.findPendingVerificationByEmail;

      if (find === undefined) {
        throw internal(
          new Error(`population "${population}" has no verification path`),
        );
      }

      const pending = await find(email);

      if (pending === undefined) {
        // No address on the line, for the reason the failed-login line carries
        // none: this endpoint is anonymous and a log full of addresses is a
        // list of who was probed, with a timestamp.
        ctx.logger.info(
          { population },
          "verification resend answered without a message",
        );

        return;
      }

      const token = await mintVerificationLink(ctx, pending.id);

      deliverDetached(
        ctx,
        pending.email,
        { population, purpose: "verify_email" },
        mailTemplates.verifyEmail({ token, locale: localeFor(locale) }),
      );

      ctx.logger.info(
        { population, principalId: pending.id },
        "verification link re-sent",
      );
    },
  } as const;
};

export type AuthMailFlows = ReturnType<typeof createAuthMailFlows>;
