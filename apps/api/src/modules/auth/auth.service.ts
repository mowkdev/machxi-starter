import type {
  AcceptOnboardingBody,
  ConfirmEmailBody,
  FederatedExchangeBody,
  ForgotPasswordBody,
  ImpersonatorResource,
  LoginBody,
  Population,
  PrincipalResource,
  RegisterBody,
  ResendVerificationBody,
  ResetPasswordBody,
  UserPrincipalResource,
  VerifyEmailBody,
} from "@repo/contracts";
import { LOCALES, type Locale } from "@repo/contracts";
import type { PasswordHasher } from "@repo/crypto";
import { randomToken, sha256Base64url } from "@repo/crypto";
import type { DbExecutor } from "@repo/db";

import type { Audit } from "../../core/audit/index.js";
import { requirePopulation } from "../../core/auth/policies.js";
import type { RequestContext } from "../../core/context/index.js";
import { internal } from "../../core/errors/index.js";
import {
  accountDisabled,
  emailChangeLinkInvalid,
  emailUnverified,
  federatedHandoffInvalid,
  impersonationHandoffInvalid,
  invalidCredentials,
  invalidRefreshToken,
  onboardingLinkInvalid,
  passwordResetLinkInvalid,
  refreshReused,
  registrationConflict,
  sessionRevoked,
  verificationLinkInvalid,
} from "./auth.errors.js";
import type { HashLimiter } from "./auth.hash-limiter.js";
import {
  toAuthResource,
  withImpersonator,
  type IssuedAuthResource,
} from "./auth.mapper.js";
import type { OrganizationsService } from "../organizations/organizations.service.js";
// The one error this module raises that belongs to another aggregate's
// vocabulary (ADR-0013): `USER_EMAIL_TAKEN` is the users module's code, and
// `confirm-email` is the second endpoint that can raise it. Imported rather
// than restated, because two factories for one code is how one sentence
// becomes two — the mirror of `currentPasswordInvalid`, which lives in this
// module and is imported by the users one.
import { userEmailTaken } from "../users/users.errors.js";
import type { AccountTokens } from "../../core/tokens/index.js";
import { createMailDelivery, localeFor } from "../../core/mail/index.js";
import type { MailSender, MailTemplates } from "../../core/mail/index.js";
import type { SessionsRepository } from "./auth.repository.js";
import type { TokenService } from "./auth.tokens.js";
import type {
  FederatedAccounts,
  PrincipalAdapter,
  PrincipalRecord,
} from "./auth.types.js";

/**
 * The authentication flows of ADR-0018, written once for both populations.
 *
 * What makes one implementation serve `staff` and `users` is the
 * `PrincipalAdapter` (ADR-0017): everything below is expressed in terms of a
 * `PrincipalRecord` and a session row, and never in terms of a table. The
 * container instantiates it twice, and the two instances share no state — only
 * code.
 *
 * `now` and `newRefreshToken` are injected (ADR-0018 §Testability) so expiry,
 * the rotation grace window and reuse detection can be unit-tested at whatever
 * instant the test chooses, without sleeping and without stubbing globals.
 */

/** Values written into `sessions.revoked_reason`, for the audit trail. */
export const REVOKE_REASONS = {
  logout: "logout",
  logoutAll: "logout_all",
  refreshReuse: "refresh_reuse",
  accountDisabled: "account_disabled",
  principalMissing: "principal_missing",
  /** `POST /api/v1/admin/{staff,users}/:id/sessions/revoke` (step 9). */
  adminRevoke: "admin_revoke",
  /** `POST /api/v1/{admin,user}/profile/change-password` (step 9, D2.3). */
  passwordChanged: "password_changed",
  /**
   * `POST /api/v1/admin/{staff,users}/:id/password` (D2.3).
   *
   * Distinct from `passwordChanged`, and the distinction is the point: the
   * audit trail has to tell "the holder changed it" apart from "somebody else
   * changed it for them" (ADR-0027 §Decision rule 3). It is also why this one
   * spares no session — the subject proved nothing, and the plausible reason
   * for a reset is that the account is compromised.
   */
  passwordReset: "password_reset",
  /**
   * `DELETE /api/v1/admin/{staff,users}/:id` (D2.4).
   *
   * Written in the same transaction as the delete itself: `sessions` has no
   * foreign key to either population (ADR-0018), so nothing else ends them —
   * and for staff the row is gone a statement later, which would leave the
   * session rows orphaned rather than revoked. An orphan is unusable, because
   * the principal lookup after session verification finds nothing, but
   * "unusable in practice" is not what an audit trail should have to infer
   * (ADR-0028).
   */
  accountDeleted: "account_deleted",
  /**
   * A role grant changed (step 9). Roles ride in the access token's claims
   * (ADR-0018), so ending the sessions is what makes the new set take effect
   * rather than waiting out `JWT_ACCESS_TTL`.
   */
  rolesChanged: "roles_changed",
  /**
   * The exit control on the impersonation banner (ADR-0057 §6, built at
   * `D13.5`).
   *
   * Its own reason rather than `logout`, because the audit trail has to tell
   * "the customer signed out" apart from "a support operator finished acting
   * as them" — the same distinction {@link REVOKE_REASONS.passwordReset} draws
   * against `passwordChanged`.
   */
  impersonationEnded: "impersonation_ended",
} as const;

export type RevokeReason = (typeof REVOKE_REASONS)[keyof typeof REVOKE_REASONS];

/**
 * What `refresh` needs, which is a token and not a request body.
 *
 * `refreshBody.refreshToken` became optional in ADR-0029 — a browser on cookie
 * transport sends an empty body — but "where the token came from" is the
 * controller's question. By the time the service is called there is either a
 * token or an error, so this type keeps the service's own precondition
 * unchanged rather than pushing the optionality down a layer that has no way
 * to resolve it.
 */
export interface RefreshInput {
  readonly refreshToken: string;
}

/** What {@link AuthService.revokeSessionsFor} acts on. */
export interface RevokeSessionsForInput {
  /** The account whose sessions end — **not** necessarily `ctx.principal`. */
  readonly principalId: string;
  readonly reason: RevokeReason;
  /** Spared, for a password change that must not log the caller out. */
  readonly exceptSessionId?: string | undefined;
  /**
   * Joins the caller's transaction, so "the account is disabled" and "its
   * sessions are gone" commit together (ADR-0018).
   */
  readonly tx?: DbExecutor | undefined;
}

/**
 * Longest user agent stored. The header is attacker-controlled and the column
 * is `text`; a bound here is the ADR-0020 input rule applied to something no
 * request schema covers, because it comes from the environment, not the body.
 */
export const MAX_USER_AGENT_LENGTH = 512;

/** What {@link AuthService.issueImpersonatedSession} acts on (ADR-0057 §3). */
export interface IssueImpersonatedSessionInput {
  /** The customer whose account the session opens — from the consumed handoff. */
  readonly principalId: string;
  /** The staff member who minted that handoff, and this session's actor. */
  readonly staffId: string;
  /**
   * Joins the exchange's transaction, so the consume, the session row and the
   * `impersonation.exchanged` audit row commit together or not at all.
   */
  readonly tx?: DbExecutor | undefined;
}

/** What {@link AuthService.endReplacedImpersonation} acts on (ADR-0070 §4). */
export interface EndReplacedImpersonationInput {
  /**
   * The user population's refresh cookie as it arrived at the exchange — the
   * raw token, hashed here exactly as `refresh` hashes the one it is given.
   */
  readonly refreshToken: string;
  /**
   * The exchange doing the replacing, off the handoff it has just consumed.
   *
   * The row's `actor` is the staff member whose impersonation is *ending*,
   * because that is whose session it is — but the human who chose to end it is
   * the operator behind the new handoff, and this route is unauthenticated, so
   * `ctx.principal` cannot supply them. Naming them in `data` is what makes the
   * row readable on a shared support workstation, where the jar's session may
   * belong to somebody else's impersonation (ADR-0070 §4).
   */
  readonly replacedBy: {
    readonly staffId: string;
    readonly handoffId: string;
  };
  /**
   * The exchange's own transaction. Required, unlike
   * {@link IssueImpersonatedSessionInput.tx}: the revoke, its audit row and the
   * session that replaces it commit together or not at all, so there is no
   * ordering in which the old session ends and the new one is never minted
   * (ADR-0070 §4).
   */
  readonly tx: DbExecutor;
}

export interface AuthServiceDeps {
  readonly population: Population;
  readonly principals: PrincipalAdapter;
  readonly sessions: SessionsRepository;
  /**
   * The audit writer (ADR-0058), for the one lifecycle event this service
   * owns: `impersonation.ended`, written when the exit control ends a session
   * minted by impersonation (ADR-0057 §6), when a staff revoke-all sweep ends
   * what that operator was driving, and when a second exchange in the same
   * browser replaces the session it finds there (ADR-0070 §4).
   *
   * Required rather than optional on both populations, even though only the
   * `user` instance can ever write a row: a dependency a caller may omit is a
   * dependency a future wiring mistake omits silently, and the failure mode
   * here is an impersonation that ends with no trail.
   */
  readonly audit: Audit;
  readonly hasher: PasswordHasher;
  readonly tokens: TokenService;
  readonly hashLimiter: HashLimiter;
  readonly refreshTtlSec: number;
  /** `REFRESH_ROTATION_GRACE_SEC` (ADR-0004). */
  readonly rotationGraceSec: number;
  /**
   * `IMPERSONATION_SESSION_TTL` (ADR-0004, ADR-0057 §4) — the **fixed** life of
   * a session minted by impersonation, anchored at the exchange and never
   * extended by a rotation.
   */
  readonly impersonationSessionTtlSec: number;
  /**
   * The staff adapter narrowed to one lookup, wired on the **user** service
   * only (ADR-0057 §4).
   *
   * It is what turns `sessions.impersonated_by_staff_id` into the
   * `impersonatedBy: { id, email }` the banner renders from — resolved at the
   * auth endpoints (exchange, refresh, `me`), never per request. Absent on the
   * staff service, because a staff session is never impersonated: the mint is
   * `/admin/users/:id` only, and a service that could not look a staff member
   * up is a service that cannot accidentally attribute one.
   */
  readonly impersonators?: Pick<PrincipalAdapter, "findById"> | undefined;
  /**
   * The organizations service narrowed to one function, wired on the **user**
   * service only — a service-to-service edge of the kind ADR-0009 permits.
   *
   * `register` is one of the three paths that bring a user into existence, and
   * ADR-0067 §2 requires all three to create the account's personal
   * organization *in the same transaction*: that is what makes "no query
   * anywhere has a no-organization branch" a property of the database rather
   * than a habit. Absent on the staff service, because staff cannot
   * self-register and are never members of an organization (§3) — a service
   * that could not create one is a service that cannot accidentally create one
   * for an operator.
   */
  readonly organizations?:
    Pick<OrganizationsService, "ensurePersonalOrganizationFor"> | undefined;
  /**
   * The account's linked identities, wired on the **user** service only
   * (ADR-0072 §3): `me` answers which ways in an account has, and the reset
   * by mail removes them all (§3, amended — built at `D19.4`). The staff
   * population has no federated login to answer about (§5), so its reset has
   * nothing to remove. Narrowed to the read and the removal, so this service
   * cannot reach the linking half of the seam.
   */
  readonly federated?:
    Pick<FederatedAccounts, "identitiesOf" | "unlinkAll"> | undefined;
  /**
   * ADR-0071 §1's mint and consume, wired on both populations.
   *
   * The `user` service uses it for verification (§3); the `staff` one has no
   * caller until the reset (§4). It is required rather than optional for the
   * reason {@link AuthServiceDeps.audit} is: a dependency a caller may omit is
   * one a future wiring mistake omits silently, and the failure here is a flow
   * that answers `202` and mails nothing.
   */
  readonly accountTokens: AccountTokens;
  /** ADR-0066 §1's port. Never a mail client a service imports. */
  readonly mail: MailSender;
  /** ADR-0071 §2's messages, built from the two SPA origins at the root. */
  readonly mailTemplates: MailTemplates;
  /**
   * Runs `fn` inside one database transaction. Registration inserts an
   * account, a role grant, its personal organization with an `owner`
   * membership, and a session; either all of them land or none does.
   */
  readonly transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  readonly now?: () => Date;
  readonly newRefreshToken?: () => string;
}

/**
 * What a `change_email` token carries beside the account it names
 * (ADR-0071 §1's `payload`, §6's flow).
 *
 * Two fields, and the second one is the reason this is a shape rather than a
 * bare string. The address is obvious — nothing changes until the link is
 * followed, so the address being moved to has to live somewhere until then,
 * and the token row is the only place that is not a second table. The
 * **locale** is there because the message this payload eventually produces is
 * sent from an *anonymous* endpoint: §2 says an account's stored locale is
 * what it is written in, and `confirm-email` has no principal to read one
 * from. Carrying it from the mint, where the account *was* acting, is what
 * lets the notice to the old address be written in the reader's language
 * without the anonymous half learning how to read a settings row.
 */
export interface EmailChangePayload {
  readonly newEmail: string;
  readonly locale: Locale;
}

/**
 * Whether a claimed `reset_password` token was minted by a **session** — the
 * set-password link of ADR-0072 §3 — rather than by the anonymous `forgot`.
 *
 * The one fact that decides whether a reset keeps the account's federated
 * identities: the session asked and the mailbox confirmed, which is the
 * account's own authority twice over. Anything else — no payload, which is
 * every link `forgot` mints, or a payload that does not say exactly this —
 * reads as the mailbox alone, and the identities go. The safe direction for
 * a malformed row to fall.
 */
export const requestedBySession = (
  payload: Record<string, unknown> | null,
): boolean => payload?.["requestedBy"] === "session";

/** Type guard over `LOCALES`, so a stored value that is no longer one is dropped. */
const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

/**
 * Reads {@link EmailChangePayload} back out of a claimed row.
 *
 * `payload` is `jsonb`, so what comes back is `unknown` whatever was written
 * (`tokens.repository.ts` says why the column is not `$type`d): the flow that
 * wrote it is the one that knows its shape, and this is that flow. An address
 * that is not a string makes the whole payload `undefined` — the caller
 * answers a dead link, because there is nothing to move the account to — while
 * a locale that is missing or no longer in `LOCALES` falls back to English,
 * which is what every template does with one it has no copy for anyway.
 */
export const readEmailChangePayload = (
  payload: Record<string, unknown> | null,
): EmailChangePayload | undefined => {
  const newEmail = payload?.["newEmail"];

  if (typeof newEmail !== "string" || newEmail === "") return undefined;

  const locale = payload?.["locale"];

  return { newEmail, locale: isLocale(locale) ? locale : "en" };
};

export const createAuthService = ({
  population,
  principals,
  sessions,
  audit,
  hasher,
  tokens,
  hashLimiter,
  refreshTtlSec,
  rotationGraceSec,
  impersonationSessionTtlSec,
  impersonators,
  organizations,
  federated,
  accountTokens,
  mail,
  mailTemplates,
  transaction,
  now = () => new Date(),
  newRefreshToken = () => randomToken(32),
}: AuthServiceDeps) => {
  const refreshExpiryFrom = (at: Date): Date =>
    new Date(at.getTime() + refreshTtlSec * 1000);

  /**
   * Every "end this account's sessions" path of this service, in one place
   * (ADR-0057 §6, amended `D13.5`).
   *
   * Two predicates, not one. `revokeAllForPrincipal` matches the rows whose
   * `principal_id` is the account — which is what every revocation in the API
   * has ever meant — and on the **staff** population a second statement
   * matches the rows that account is *impersonating through*. Those rows are
   * `principal_type = 'user'` carrying a customer's id, so the first predicate
   * cannot see them: disabling an operator, deleting them, or pressing the
   * forced-logout button would otherwise leave them a full-access customer
   * session for the rest of `IMPERSONATION_SESSION_TTL`.
   *
   * It runs on **every** staff revoke-all path rather than only the three
   * ADR-0057 §6 enumerated, which is the amendment this function is: a
   * revocation that must not reach an impersonated session does not exist, and
   * a seventh path added later inherits the sweep instead of having to
   * remember it. `exceptSessionId` is deliberately not carried across — it
   * spares the caller's own *staff* session, and an impersonated session is a
   * different row of a different population that the caller is not on.
   *
   * Each ended row gets an **`impersonation.ended` audit row of its own**, on
   * `record`'s lifecycle discipline and inside the caller's transaction
   * (`D13.5`, out of `security-reviewer`'s finding 2). Without it the exit
   * control produced `minted → exchanged → ended` and an operator revoked *for
   * cause* — the case this sweep exists for, and the one an incident actually
   * queries — produced `minted → exchanged → ` nothing at all, with
   * `sessions.revoked_reason` as the only trace: a prunable free-text column,
   * which is exactly the near-audit ADR-0058 §Context was written to replace.
   *
   * Ordinary sessions are untouched by construction: `impersonated_by_staff_id`
   * is null on all of them, and the second predicate is an equality on it — so
   * on the user population nothing below the first statement runs at all.
   */
  const revokeEverySessionOf = async (
    ctx: RequestContext,
    input: {
      readonly principalId: string;
      readonly reason: RevokeReason;
      readonly at: Date;
      readonly exceptSessionId?: string | undefined;
    },
    tx?: DbExecutor,
  ): Promise<{ readonly revoked: number; readonly impersonated: number }> => {
    const revoked = await sessions.revokeAllForPrincipal(
      {
        principalType: population,
        principalId: input.principalId,
        reason: input.reason,
        at: input.at,
        exceptSessionId: input.exceptSessionId,
      },
      tx,
    );

    if (population !== "staff") return { revoked, impersonated: 0 };

    const ended = await sessions.revokeAllImpersonatedBy(
      {
        staffId: input.principalId,
        // Its own reason, never the caller's: the audit trail has to be able
        // to tell "this staff session was revoked" from "the customer sessions
        // that staff member was driving ended with it".
        reason: REVOKE_REASONS.impersonationEnded,
        at: input.at,
      },
      tx,
    );

    for (const session of ended) {
      await audit.record(
        ctx,
        {
          event: "impersonation.ended",
          identities: {
            actor: { type: "staff", id: input.principalId },
            actingAs: { type: "user", id: session.principalId },
          },
          // `reason` is the revocation that ended it — `account_disabled`,
          // `account_deleted`, `admin_revoke` — which is the difference
          // between "the operator left" and "the operator was removed", and
          // the first question asked of a row like this.
          data: { sessionId: session.id, reason: input.reason },
        },
        tx,
      );
    }

    return { revoked, impersonated: ended.length };
  };

  /**
   * `sessions.impersonated_by_staff_id` → the wire field the banner renders
   * from (ADR-0057 §4).
   *
   * Resolved from the `staff` table at the auth endpoints only — the exchange,
   * refresh and `me`, all of which already hold the session row — and never
   * per authenticated request: an ordinary request reads the id off the access
   * token's `act` claim instead (`D13.5`).
   *
   * A staff member hard-deleted (ADR-0028) mid-impersonation resolves to
   * `undefined`, and the session keeps working without a banner. That is the
   * lesser of two wrongs on this path: the alternative is ending a support
   * operator's session because somebody else's account was closed, and the
   * attribution survives on the session row either way. The **exchange**
   * answers it differently — see {@link issueImpersonatedSession}, where a
   * session that could never show a banner is refused rather than created.
   */
  const resolveImpersonator = async (
    staffId: string,
  ): Promise<ImpersonatorResource | undefined> => {
    const record = await impersonators?.findById(staffId);

    return record === undefined
      ? undefined
      : { id: record.id, email: record.email };
  };

  /**
   * Attaches the actor to a principal that is about to go on the wire.
   *
   * `PrincipalRecord.resource` is the union and `withImpersonator` takes the
   * customer shape alone, so the narrowing has to happen somewhere. Stated as
   * a refusal rather than a cast: the branch is unreachable today — only the
   * user-population service is wired with `impersonators` — and a future
   * second mint path must fail loudly here rather than quietly putting an
   * actor on a staff principal (ADR-0057 §4).
   */
  const asImpersonated = (
    resource: PrincipalResource,
    staff: ImpersonatorResource,
  ): UserPrincipalResource => {
    if (resource.kind !== "user") {
      throw internal(
        new Error(
          "only a user principal can be impersonated (ADR-0057 §4): the mint is /admin/users/:id only",
        ),
      );
    }

    return withImpersonator(resource, staff);
  };

  /**
   * Creates the session row and the access token that names it.
   *
   * The refresh token is generated here and returned to the caller exactly
   * once — only its SHA-256 digest is stored, so no later read of the database
   * can produce a usable credential (ADR-0018).
   *
   * `impersonation` is the one thing that makes a session different, and it
   * makes it different in three places at once (ADR-0057 §4): the row carries
   * the actor column, the expiry is a **fixed** end rather than the sliding
   * `REFRESH_TOKEN_TTL`, and the access token is both capped at that end and
   * stamped with the RFC 8693 `act` claim. Absent — every login, every
   * registration — nothing below changes at all.
   */
  const issueSession = async (
    ctx: RequestContext,
    principal: PrincipalRecord,
    at: Date,
    tx?: DbExecutor,
    impersonation?: ImpersonatorResource,
  ): Promise<IssuedAuthResource> => {
    const refreshToken = newRefreshToken();
    const refreshTokenExpiresAt =
      impersonation === undefined
        ? refreshExpiryFrom(at)
        : new Date(at.getTime() + impersonationSessionTtlSec * 1000);

    const session = await sessions.create(
      {
        principalType: population,
        principalId: principal.id,
        refreshTokenHash: sha256Base64url(refreshToken),
        refreshTokenExpiresAt,
        ip: ctx.ip,
        userAgent: ctx.userAgent?.slice(0, MAX_USER_AGENT_LENGTH),
        ...(impersonation === undefined
          ? {}
          : { impersonatedByStaffId: impersonation.id }),
      },
      tx,
    );

    const access = await tokens.issue({
      principalId: principal.id,
      population,
      sessionId: session.id,
      roles: principal.roles,
      ...(impersonation === undefined
        ? {}
        : {
            // No JWT outlives the session it names (ADR-0057 §4).
            notAfter: refreshTokenExpiresAt,
            actorId: impersonation.id,
          }),
    });

    return toAuthResource({
      principal:
        impersonation === undefined
          ? principal.resource
          : asImpersonated(principal.resource, impersonation),
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      refreshTokenExpiresAt,
    });
  };

  /** Every password comparison goes through the limiter (ADR-0020). */
  const verifyPassword = (storedHash: string, password: string) =>
    hashLimiter.run(() => hasher.verify(storedHash, password));

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
     * `POST /auth/login` (ADR-0018 §Login).
     *
     * The order of the checks is the decision: the password is verified
     * **before** the account status is looked at, so "this address exists but
     * is disabled" cannot be learned without the password. And the verifier
     * runs even when no account matched, against `dummyHash()` at the same
     * cost parameters, so the response time does not answer "does this email
     * exist?" either.
     */
    login: async (
      ctx: RequestContext,
      { email, password }: LoginBody,
    ): Promise<IssuedAuthResource> => {
      const at = now();
      const principal = await principals.findByEmail(email);

      // `?? dummyHash()` also covers a real account with no password
      // (`users.password_hash` is nullable, ADR-0017): null means "this
      // account has no password login", never "any password matches".
      const storedHash = principal?.passwordHash ?? (await hasher.dummyHash());
      const verified = await verifyPassword(storedHash, password);

      if (principal === undefined || !verified) {
        // No email in the log line: a failed-login line is written for every
        // guess, and a log full of addresses is a credential-stuffing list
        // with a timestamp. The request id correlates it with the access line.
        ctx.logger.warn({ population }, "login failed");

        throw invalidCredentials();
      }

      if (!principal.active) {
        // Two refusals, and the split is ADR-0071 §3's: an address that was
        // never proven is a thing the caller can fix from the sign-in page,
        // and a disabled account is not. Both are raised only here, after the
        // password verified, so neither tells an anonymous guesser anything
        // (ADR-0020 §Enumeration).
        if (principal.awaitingEmailVerification) {
          ctx.logger.warn(
            { population, principalId: principal.id },
            "login refused: the address has not been confirmed",
          );

          throw emailUnverified();
        }

        ctx.logger.warn(
          { population, principalId: principal.id },
          "login refused for an inactive account",
        );

        throw accountDisabled();
      }

      // Transparent parameter upgrade (ADR-0018 §Password hashing): the
      // plaintext is only available here, so this is the one moment an
      // account hashed under older `ARGON2_*` values can be re-hashed.
      if (
        principal.passwordHash !== null &&
        hasher.needsRehash(principal.passwordHash)
      ) {
        const upgraded = await hashLimiter.run(() => hasher.hash(password));

        await principals.updatePasswordHash(principal.id, upgraded, at);
        ctx.logger.info(
          { population, principalId: principal.id },
          "password hash upgraded",
        );
      }

      const auth = await issueSession(ctx, principal, at);

      await principals.touchLastLogin(principal.id, at);

      ctx.logger.info(
        { population, principalId: principal.id },
        "login succeeded",
      );

      return auth;
    },

    /**
     * `POST /auth/refresh` (ADR-0018 §Refresh).
     *
     * Rotation with reuse detection. A token that matches the *previous* hash
     * is either a client retrying inside `REFRESH_ROTATION_GRACE_SEC` — a lost
     * response, a double-tap, two tabs — or a stolen token being replayed. The
     * window is the only thing that separates them, and outside it the session
     * is revoked rather than merely refused: if the token was replayed, the
     * legitimate holder's session is what the attacker would use next.
     */
    refresh: async (
      ctx: RequestContext,
      { refreshToken }: RefreshInput,
    ): Promise<IssuedAuthResource> => {
      const at = now();
      const presentedHash = sha256Base64url(refreshToken);

      let session = await sessions.findByRefreshTokenHash(presentedHash);

      if (session === undefined) {
        const rotated =
          await sessions.findByPreviousRefreshTokenHash(presentedHash);

        if (rotated === undefined) throw invalidRefreshToken();

        // Both of these run **before** the reuse branch, because that branch
        // has a side effect.
        //
        // Population: a session of the other population must be
        // indistinguishable from an unknown token (ADR-0019 §1). Revoking it
        // and answering `AUTH_REFRESH_REUSED` from the wrong segment would be
        // both a distinguishable code and a cross-segment state change.
        if (rotated.principalType !== population) throw invalidRefreshToken();

        // Already revoked: the ordinary "logged out, then a stale tab retried"
        // case. It is not theft, and logging it as theft is how a `warn` that
        // is supposed to mean "a token was stolen" stops meaning anything
        // (ADR-0020 §Audit trail).
        if (rotated.revokedAt !== null) throw sessionRevoked();

        const withinGrace =
          rotated.rotatedAt !== null &&
          at.getTime() - rotated.rotatedAt.getTime() <= rotationGraceSec * 1000;

        if (!withinGrace) {
          await sessions.revoke({
            id: rotated.id,
            reason: REVOKE_REASONS.refreshReuse,
            at,
          });

          ctx.logger.warn(
            {
              population: rotated.principalType,
              principalId: rotated.principalId,
              sessionId: rotated.id,
            },
            "refresh token reuse detected, session revoked",
          );

          throw refreshReused();
        }

        // Inside the window this is a legitimate retry, so it is served like
        // any other refresh: the session rotates again from its *current*
        // hash. The pair issued by the first call therefore keeps working for
        // another grace window as the new previous hash, which is what makes
        // two concurrent refreshes both succeed.
        session = rotated;
      }

      // Population first, before anything more specific: a session of the
      // other population must be indistinguishable from an unknown token, or
      // the difference becomes a probe (ADR-0019).
      if (session.principalType !== population) throw invalidRefreshToken();

      if (session.revokedAt !== null) throw sessionRevoked();
      if (session.refreshTokenExpiresAt.getTime() <= at.getTime()) {
        throw invalidRefreshToken();
      }

      const principal = await principals.findById(session.principalId);

      if (principal === undefined) {
        // The account was deleted while a session was live. `sessions` has no
        // foreign key to either population (ADR-0018), so nothing else cleans
        // this up.
        await sessions.revoke({
          id: session.id,
          reason: REVOKE_REASONS.principalMissing,
          at,
        });

        throw invalidRefreshToken();
      }

      if (!principal.active) {
        await revokeEverySessionOf(ctx, {
          principalId: principal.id,
          reason: REVOKE_REASONS.accountDisabled,
          at,
        });

        ctx.logger.warn(
          { population, principalId: principal.id },
          "refresh refused for an inactive account, sessions revoked",
        );

        throw accountDisabled();
      }

      const nextToken = newRefreshToken();
      // **Rotation without extension** — the one change ADR-0057 §4 makes to
      // this flow, and it applies only while the actor column is set. An
      // impersonated session keeps the end anchored at its exchange, so
      // reloading the customer app survives (the session does) while the
      // window does not move. An impersonation that needs more time is
      // re-minted, on the trail, never extended.
      const actorId = session.impersonatedByStaffId;
      const refreshTokenExpiresAt =
        actorId === null
          ? refreshExpiryFrom(at)
          : session.refreshTokenExpiresAt;

      const rotated = await sessions.rotate({
        id: session.id,
        expectedRefreshTokenHash: session.refreshTokenHash,
        refreshTokenHash: sha256Base64url(nextToken),
        refreshTokenExpiresAt,
        at,
      });

      // Zero rows means another request rotated or revoked this session
      // between the read above and this write. Refusing is correct: the token
      // this caller holds is no longer the current one.
      if (rotated === undefined) throw invalidRefreshToken();

      // Resolved from the row rather than carried from the exchange, which is
      // what makes the banner survive a reload: the session is the source of
      // truth, and this is one of the three endpoints ADR-0057 §4 lets it be
      // read at.
      const impersonatedBy =
        actorId === null ? undefined : await resolveImpersonator(actorId);

      const access = await tokens.issue({
        principalId: principal.id,
        population,
        sessionId: session.id,
        roles: principal.roles,
        ...(actorId === null
          ? {}
          : { notAfter: refreshTokenExpiresAt, actorId }),
      });

      ctx.logger.info(
        {
          population,
          principalId: principal.id,
          sessionId: session.id,
          ...(actorId === null ? {} : { impersonatedBy: actorId }),
        },
        "session refreshed",
      );

      return toAuthResource({
        principal:
          impersonatedBy === undefined
            ? principal.resource
            : asImpersonated(principal.resource, impersonatedBy),
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt,
        refreshToken: nextToken,
        refreshTokenExpiresAt,
      });
    },

    /**
     * The exchange's half of `POST /user/auth/impersonate` (ADR-0057 §3, §4).
     *
     * The handoff has already been consumed atomically by the impersonation
     * service; what is left is the part only this module may do, because
     * `sessions` is its aggregate. Everything a login session gets, an
     * impersonated one gets too — rotation, reuse detection, the grace window
     * — and the three deltas are all inside {@link issueSession}.
     *
     * Both accounts are re-read here rather than trusted from the handoff row,
     * and each refusal is the same one:
     *
     * - **The target** must still be a live, active customer. A minute passes
     *   between the mint and the exchange at most, but "the account was
     *   disabled in that minute" must not open anyway, and the mint's check
     *   cannot speak for the exchange's instant.
     * - **The minting staff member** must still exist and be active. A session
     *   whose actor cannot be resolved is a session the customer app can never
     *   draw a banner on (ADR-0057 §7 makes that banner unremovable), and an
     *   impersonation nobody can see is the thing this whole record exists to
     *   prevent. Refusing here is not the same judgement {@link
     *   resolveImpersonator} makes on refresh: there a session already exists
     *   and ending it would punish the operator for somebody else's deletion.
     *
     * It never throws a *distinguishable* error: refusals go out as the
     * impersonation service's one indistinguishable `401`, so the exchange
     * cannot be used to ask whether an account exists, is disabled, or was
     * already redeemed (ADR-0020 §Enumeration).
     *
     * @throws AppError `UNAUTHENTICATED` for every refusal.
     */
    issueImpersonatedSession: async (
      ctx: RequestContext,
      { principalId, staffId, tx }: IssueImpersonatedSessionInput,
    ): Promise<IssuedAuthResource> => {
      const at = now();

      // Sequential rather than `Promise.all`: both reads run on the exchange's
      // transaction, which is one reserved connection, so concurrency here buys
      // nothing and only raises the question of what two in-flight statements
      // on one transaction do.
      const target = await principals.findById(principalId, tx);
      // `undefined` when this service has no staff adapter at all — the staff
      // population's instance, which therefore refuses below. A staff session
      // is never impersonated (ADR-0057 §4), and this is what makes that a
      // property of the wiring rather than of a caller's discipline.
      const actor = await impersonators?.findById(staffId, tx);

      if (target === undefined || !target.active) {
        ctx.logger.warn(
          { population, principalId, staffId },
          "impersonation exchange refused: the target is not an active account",
        );

        throw impersonationHandoffInvalid();
      }

      if (actor === undefined || !actor.active) {
        ctx.logger.warn(
          { population, principalId, staffId },
          "impersonation exchange refused: the minting staff member is gone or inactive",
        );

        throw impersonationHandoffInvalid();
      }

      const auth = await issueSession(ctx, target, at, tx, {
        id: actor.id,
        email: actor.email,
      });

      ctx.logger.info(
        {
          population,
          principalId: target.id,
          impersonatedBy: actor.id,
          endsAt: auth.refreshTokenExpiresAt,
        },
        "impersonated session issued",
      );

      return auth;
    },

    /**
     * Ends the impersonated session a second exchange in the same browser
     * replaces (ADR-0070 §4).
     *
     * The user population's cookies are one jar, and since the admin panel now
     * stays on screen a second Impersonate is one click away. Without this, the
     * exchange would overwrite the first tab's cookies and leave its session
     * live for the rest of `IMPERSONATION_SESSION_TTL`: the stale tab's next
     * refresh would answer with the **second** customer's principal, the banner
     * would swap names, and nothing would say so on the trail. The API is the
     * only place that can see it — the refresh cookie is path-scoped to
     * `/api/v1/user/auth` and the exchange is a route under that path.
     *
     * Three conditions, and every one of them is a decision rather than a
     * defence:
     *
     * - **The row must be this population's.** Nothing else can reach the
     *   cookie's path, but a session of the other population resolving here
     *   would be a cross-segment revocation from an unauthenticated route.
     * - **The row must be live.** A revoked or expired session is already over;
     *   revoking it again would write a second `impersonation.ended` row for an
     *   impersonation that had already ended, and the audit table is the one
     *   nothing prunes.
     * - **The row must carry an actor.** A cookie that resolves to a **real**
     *   customer session is left exactly as ADR-0057 §3 decided — overwritten
     *   in the jar, alive in the database, other devices untouched. Ending it
     *   would end a session that was not the operator's to end.
     *
     * A cookie that resolves to nothing — expired, unknown, revoked — is
     * ignored, as it is on any other request, and the exchange's own refusals
     * are unchanged. Only the **current** hash is matched, and the gap that
     * leaves is deliberate rather than overlooked: a token one rotation stale
     * is still spendable at `refresh` inside `REFRESH_ROTATION_GRACE_SEC`
     * (ADR-0018 §Refresh), so a browser whose rotation response was lost keeps
     * its old impersonation alive until its fixed end. Reaching the previous
     * hash from here would put a revoke behind reuse detection's own
     * ambiguity, and the miss is bounded: the exchange overwrites the jar, so
     * the session it failed to end is one no tab can reach.
     *
     * @returns whether a session was ended, for the caller's log line — which
     * is the caller's rather than this function's because the transaction it
     * runs in can still roll back underneath it, and a log line cannot.
     */
    endReplacedImpersonation: async (
      ctx: RequestContext,
      { refreshToken, replacedBy, tx }: EndReplacedImpersonationInput,
    ): Promise<boolean> => {
      const at = now();
      const session = await sessions.findByRefreshTokenHash(
        sha256Base64url(refreshToken),
        tx,
      );

      if (
        session === undefined ||
        session.principalType !== population ||
        session.revokedAt !== null ||
        session.refreshTokenExpiresAt.getTime() <= at.getTime() ||
        session.impersonatedByStaffId === null
      ) {
        return false;
      }

      await sessions.revoke(
        {
          id: session.id,
          reason: REVOKE_REASONS.impersonationEnded,
          at,
        },
        tx,
      );

      await audit.record(
        ctx,
        {
          event: "impersonation.ended",
          identities: {
            actor: { type: "staff", id: session.impersonatedByStaffId },
            actingAs: { type: "user", id: session.principalId },
          },
          // `replaced`, and that word is the point of the row: it separates a
          // second impersonation in the same browser from the exit control's
          // `logout` and from a revocation for cause, which is the distinction
          // ADR-0057 §6 asks `data` to carry. The two ids beside it name the
          // exchange that did the replacing, whose operator is not necessarily
          // the actor above — a shared support workstation is one jar and two
          // people (ADR-0070 §4).
          data: {
            sessionId: session.id,
            reason: "replaced",
            replacedByStaffId: replacedBy.staffId,
            replacedByHandoffId: replacedBy.handoffId,
          },
        },
        tx,
      );

      return true;
    },

    /**
     * `POST /auth/logout` — revokes the session the access token names.
     *
     * **And it is the impersonation exit** (ADR-0057 §6). `logout` is
     * deliberately not on §5's exclusion list, because the banner's one
     * control calls it: the operator leaves the same way the customer would.
     * What changes when the actor column is set is the reason written to the
     * row and one audit event — the trail has to tell "the customer signed
     * out" apart from "a support operator finished acting as them", the same
     * distinction `passwordReset` draws against `passwordChanged`.
     *
     * The impersonated branch is transactional: the revoke and the
     * `impersonation.ended` row commit together, on `audit.record`'s lifecycle
     * discipline, so no impersonation can end without its trail (ADR-0058).
     * An ordinary logout takes the identical single-statement path it always
     * has, transaction included — there is nothing to join.
     */
    logout: async (ctx: RequestContext): Promise<void> => {
      const principal = requirePopulation(ctx, population);
      const at = now();
      const actorId =
        principal.kind === "user" ? principal.impersonatedBy : undefined;

      if (actorId === undefined) {
        await sessions.revoke({
          id: principal.sessionId,
          reason: REVOKE_REASONS.logout,
          at,
        });

        ctx.logger.info(
          {
            population,
            principalId: principal.id,
            sessionId: principal.sessionId,
          },
          "logged out",
        );

        return;
      }

      await transaction(async (tx) => {
        await sessions.revoke(
          {
            id: principal.sessionId,
            reason: REVOKE_REASONS.impersonationEnded,
            at,
          },
          tx,
        );

        await audit.record(
          ctx,
          {
            event: "impersonation.ended",
            // Explicit rather than derived, even though `ctx.principal` would
            // derive the same pair here: this row states the two identities
            // the event is *about*, and a reader of this call site should not
            // have to open the audit service to find out which way round they
            // go (ADR-0058).
            identities: {
              actor: { type: "staff", id: actorId },
              actingAs: { type: "user", id: principal.id },
            },
            data: { sessionId: principal.sessionId, reason: "logout" },
          },
          tx,
        );
      });

      ctx.logger.info(
        {
          population,
          principalId: principal.id,
          sessionId: principal.sessionId,
          impersonatedBy: actorId,
        },
        "impersonation ended",
      );
    },

    /**
     * `POST /auth/logout-all` — every device, including this one.
     *
     * On the user segment this is one of ADR-0057 §5's excluded operations and
     * an impersonated caller never reaches it: `refuseImpersonated` is mounted
     * on the route, because ending the *customer's* real sessions everywhere
     * is a takeover step and not support work.
     */
    logoutAll: async (ctx: RequestContext): Promise<void> => {
      const principal = requirePopulation(ctx, population);
      const at = now();

      const { revoked, impersonated } = await revokeEverySessionOf(ctx, {
        principalId: principal.id,
        reason: REVOKE_REASONS.logoutAll,
        at,
      });

      ctx.logger.info(
        { population, principalId: principal.id, revoked, impersonated },
        "logged out of every session",
      );
    },

    /**
     * `GET /auth/me` — the principal, re-read from the database.
     *
     * Deliberately not assembled from the token's claims: `me` exists so a
     * client can resynchronise after a role or profile change, and claims are
     * up to one access-token lifetime stale (ADR-0018 §Authenticated request).
     */
    // `impersonatedBy` is deliberately absent from this response, and ADR-0057
    // §4 was amended at `D13.4` to say so rather than leaving the decision in
    // this comment: `me` is the resynchronisation endpoint, both SPAs boot off
    // `refresh` (which carries the field), and resolving it here would cost a
    // second primary-key probe on every `me` of both populations — including
    // every ordinary one — for a client that has already been told.
    me: async (ctx: RequestContext): Promise<PrincipalResource> => {
      const authenticated = requirePopulation(ctx, population);
      const principal = await principals.findById(authenticated.id);

      if (principal === undefined || !principal.active) {
        // The account was deleted or disabled inside the token's lifetime.
        // Revoking here rather than only refusing means the refresh token dies
        // with it, instead of minting a fresh access token 15 minutes later.
        await revokeEverySessionOf(ctx, {
          principalId: authenticated.id,
          reason:
            principal === undefined
              ? REVOKE_REASONS.principalMissing
              : REVOKE_REASONS.accountDisabled,
          at: now(),
        });

        throw sessionRevoked();
      }

      // Which ways in this account has (ADR-0072 §3), on the user population
      // alone: `me` is where a client resynchronises, and "Set a password" or
      // "Link Google" is decided from these two fields. Never on the
      // token-issuing bodies — login and refresh do not need them, and the
      // principal read behind them stays one statement.
      if (principal.resource.kind === "user" && federated !== undefined) {
        return {
          ...principal.resource,
          hasPassword: principal.passwordHash !== null,
          identities: await federated.identitiesOf(principal.id),
        };
      }

      return principal.resource;
    },

    /**
     * Ends every live session of one account of this population.
     *
     * The one session operation whose subject is somebody *other* than the
     * caller, which is why it takes a `principalId` and does not consult
     * `ctx.principal`: an admin revoking a staff member's sessions and a user
     * changing their own password are the same write, and authorising them is
     * the calling service's job, not this one's (ADR-0019 §3).
     *
     * It lives here rather than in the staff and users services because
     * `sessions` is the auth module's aggregate. Those services depend on this
     * one function — `Pick<AuthService, "revokeSessionsFor">` — which is the
     * "a module may depend on another module's service" rule of ADR-0009
     * narrowed to exactly what they need.
     *
     * @returns how many sessions were revoked.
     */
    revokeSessionsFor: async (
      ctx: RequestContext,
      { principalId, reason, exceptSessionId, tx }: RevokeSessionsForInput,
    ): Promise<number> => {
      const { revoked, impersonated } = await revokeEverySessionOf(
        ctx,
        { principalId, reason, at: now(), exceptSessionId },
        tx,
      );

      if (revoked > 0 || impersonated > 0) {
        ctx.logger.info(
          { population, principalId, revoked, impersonated, reason },
          "sessions revoked",
        );
      }

      // The account's **own** sessions, which is what every caller counts and
      // reports. The impersonated rows are a different population's and are on
      // the log line above rather than in this number.
      return revoked;
    },

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
     * `POST /api/v1/public/auth/google/exchange` (ADR-0072 §2) — the fragment
     * token the Google callback minted, for a session.
     *
     * {@link verifyEmail}'s shape inherited whole: claim the `federated_login`
     * token, re-read the account, issue the session and stamp the login, in
     * one transaction, so every refusal rolls the claim back with it.
     *
     * **The account is re-read and must still be `active`** (`D19.1`'s
     * `security-reviewer`, carried to this step). The callback checked it a
     * few seconds ago, but a disable does not supersede a live handoff, and
     * "disabled in that minute" must not open anyway — the impersonation
     * exchange's reasoning about its own mint, applied to this one.
     *
     * Every refusal is the same `401` (ADR-0020 §Enumeration): unknown, spent,
     * expired, of another purpose, or naming an account that is gone or no
     * longer active.
     */
    exchangeFederatedHandoff: async (
      ctx: RequestContext,
      { token }: FederatedExchangeBody,
    ): Promise<IssuedAuthResource> => {
      if (population !== "user") {
        // The route is mounted from the user controller on the public
        // segment; a staff twin would be a way to turn a URL fragment into an
        // operator's session, which no federated flow may mint (ADR-0072 §5).
        throw internal(
          new Error(`population "${population}" has no federated sign-in`),
        );
      }

      const at = now();

      return transaction(async (tx) => {
        const claimed = await accountTokens.consume(
          ctx,
          { purpose: "federated_login", principalType: population, token },
          tx,
        );

        if (claimed === undefined) throw federatedHandoffInvalid();

        const principal = await principals.findById(claimed.principalId, tx);

        if (principal === undefined || !principal.active) {
          ctx.logger.warn(
            { population, tokenId: claimed.id },
            "federated exchange refused: the account is gone or not active",
          );

          throw federatedHandoffInvalid();
        }

        const auth = await issueSession(ctx, principal, at, tx);

        await principals.touchLastLogin(principal.id, at, tx);

        ctx.logger.info(
          { population, principalId: principal.id },
          "signed in through a federated identity",
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
     * new hash, **remove every federated identity** unless the session itself
     * asked for the link (ADR-0072 §3, amended at `D19.4`), record it, and
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
        // the subject never. **Kept** only when the link was the session's
        // own set-password link — the session asked, the mailbox confirmed.
        const removed =
          federated === undefined || requestedBySession(claimed.payload)
            ? []
            : await federated.unlinkAll(principal.id, tx);

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

        // In the same commit as the new hash, beside the session sweep below
        // and for its reason (`D18.9`'s `security-reviewer`): a pending
        // `change_email` link is a credential the account did not choose,
        // mailed to an address somebody else typed, and the session sweep
        // cannot see it. Recovery is the flow a person reaches when the
        // account is already in somebody else's hands, so a link that outlived
        // it would hand the account back an hour later.
        await accountTokens.supersede(
          ctx,
          {
            purpose: "change_email",
            principal: { type: population, id: principal.id },
          },
          tx,
        );

        // `identities` rather than the context's principal: the route is
        // anonymous — the token is the credential — so the actor comes off the
        // row that was claimed (ADR-0058, verification's shape).
        await audit.record(
          ctx,
          {
            event: "account.password_reset",
            identities: { actor: { type: population, id: principal.id } },
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

export type AuthService = ReturnType<typeof createAuthService>;
