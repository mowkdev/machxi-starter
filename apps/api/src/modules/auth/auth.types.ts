import type {
  FederatedIdentityResource,
  FederatedProvider,
  Locale,
  Population,
  PrincipalResource,
  Role,
} from "@repo/contracts";
import { LOCALES } from "@repo/contracts";
import type { PasswordHasher } from "@repo/crypto";
import type { DbExecutor } from "@repo/db";

import type { Audit } from "../../core/audit/index.js";
import type { MailSender, MailTemplates } from "../../core/mail/index.js";
import type { AccountTokens } from "../../core/tokens/index.js";
import type { OrganizationsService } from "../organizations/organizations.service.js";
import type { HashLimiter } from "./auth.hash-limiter.js";
import type { SessionsRepository } from "./auth.repository.js";
import type { TokenService } from "./auth.tokens.js";

/**
 * The seam that lets one auth service serve both populations (ADR-0017).
 *
 * `createAuthService` is written once and instantiated twice — once with the
 * staff adapter, once with the user adapter. Everything that differs between
 * `staff` and `users` (which table, which status counts as active, whether the
 * password hash may be null, what the wire resource looks like) is decided
 * behind this interface, so the login, refresh, rotation and revocation logic
 * exists in exactly one place.
 */

/**
 * A principal as the auth service needs it, whichever table it came from.
 *
 * `resource` is the already-mapped wire form rather than raw name columns: the
 * two populations type their names differently (ADR-0017), and building the
 * resource inside the adapter is what lets this interface stay flat without
 * either erasing that difference or making the service generic over it.
 *
 * `active` is a boolean rather than the raw `status`, for the same reason
 * ADR-0017 gives the adapter an `isActive`: which enum values count as active
 * is the population's business, and the status value itself never needs to
 * leave the repository layer.
 */
export interface PrincipalRecord {
  readonly id: string;
  readonly email: string;
  /** `null` for an account with no password login (users only, ADR-0017). */
  readonly passwordHash: string | null;
  readonly active: boolean;
  /**
   * Why the account is not active, in the one case the answer differs on the
   * wire (ADR-0071 §3).
   *
   * `true` only for a `user` row whose status is `pending_verification`;
   * `false` on every staff row, `invited` included — an operator waiting for
   * onboarding is refused as any inactive row is (ADR-0071 §8), because there
   * the missing thing is a password rather than a proof of the mailbox.
   *
   * A boolean rather than the raw `status` for the reason {@link active} is
   * one: which enum values mean what is the population's business, decided in
   * the adapter, and the status itself never leaves the repository layer
   * (ADR-0017 §Principal abstraction in code).
   */
  readonly awaitingEmailVerification: boolean;
  readonly roles: readonly Role[];
  readonly resource: PrincipalResource;
}

/**
 * The minimum an anonymous flow may learn about an account it is about to mail
 * (ADR-0071 §3, §4).
 *
 * Not a {@link PrincipalRecord}: `resend-verification` and `password/forgot`
 * answer `202` whatever they find, so what they need is an id to mint against
 * and the address as the database holds it — never the password hash, the
 * roles or the wire resource. Two anonymous endpoints reaching for a record
 * that carries a credential is how one of them eventually returns it.
 */
export interface MailablePrincipal {
  readonly id: string;
  readonly email: string;
}

/** What registration inserts. Only the user adapter implements it. */
export interface CreatePrincipalInput {
  readonly email: string;
  readonly passwordHash: string;
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
}

export interface PrincipalAdapter<P extends Population = Population> {
  readonly population: P;
  findByEmail: (
    email: string,
    tx?: DbExecutor,
  ) => Promise<PrincipalRecord | undefined>;
  findById: (
    id: string,
    tx?: DbExecutor,
  ) => Promise<PrincipalRecord | undefined>;
  /** ADR-0018 login step 5. */
  touchLastLogin: (id: string, at: Date, tx?: DbExecutor) => Promise<void>;
  /** Transparent argon2 parameter upgrade on a successful login. */
  updatePasswordHash: (
    id: string,
    passwordHash: string,
    at: Date,
    tx?: DbExecutor,
  ) => Promise<void>;
  /**
   * Self-registration, and therefore **absent on the staff adapter**: staff
   * are created by an admin, never by themselves (ADR-0017 §Invariants). The
   * public register route is mounted from the user service only; the service
   * refuses rather than assuming, because "this population cannot self
   * register" is a rule, not a missing feature.
   *
   * Resolves to `undefined` when the email is already taken.
   */
  create?: (
    input: CreatePrincipalInput,
    tx?: DbExecutor,
  ) => Promise<PrincipalRecord | undefined>;
  /**
   * The verification link's effect, and therefore **users only** (ADR-0071
   * §3): the account becomes `active` and its address is stamped proven, in
   * the transaction that consumed the token.
   *
   * Resolves to `undefined` when no row moved — the account is deleted, or
   * already past `pending_verification` — which the caller answers by throwing
   * so the consume rolls back with it. A refused verification spends nothing.
   */
  activateVerified?: (
    id: string,
    at: Date,
    tx?: DbExecutor,
  ) => Promise<PrincipalRecord | undefined>;
  /**
   * The address change's write, and therefore **users only** (ADR-0071 §6):
   * a staff member's address is set by a super admin rather than proven by a
   * link (§7), so the staff adapter has nothing to implement.
   *
   * The new address and `email_verified_at` move together, inside the
   * transaction that consumed the token. Resolves to `undefined` when no row
   * moved — the account was deleted or disabled since the request, or another
   * account claimed the address in the meantime — which the caller answers by
   * throwing, so the consume rolls back and a refused confirmation spends
   * nothing.
   */
  changeEmailVerified?: (
    id: string,
    email: string,
    at: Date,
    tx?: DbExecutor,
  ) => Promise<PrincipalRecord | undefined>;
  /**
   * The onboarding link's effect, and therefore **staff only** (ADR-0071 §8):
   * the operator's first password and the move out of `invited`, in the
   * transaction that consumed the token.
   *
   * The mirror of {@link activateVerified} across the two populations, and the
   * asymmetry is the two flows': a user proves a mailbox and needs no password
   * because they already chose one, while an operator has no password at all
   * until this call and their address was asserted by whoever created the row
   * (ADR-0071 §3).
   *
   * Resolves to `undefined` when no row moved — the account was deleted or
   * disabled since the mint, or has already onboarded — which the caller
   * answers by throwing, so the consume rolls back and a refused accept spends
   * nothing.
   */
  activateOnboarded?: (
    id: string,
    passwordHash: string,
    at: Date,
    tx?: DbExecutor,
  ) => Promise<PrincipalRecord | undefined>;
  /**
   * "Does a live account of this population already hold this address?"
   * (ADR-0071 §6), and **users only** for {@link changeEmailVerified}'s
   * reason.
   *
   * A boolean rather than a record, because the caller is an anonymous route:
   * the confirmation must be able to answer `409` without any path existing
   * through which it could reach a stranger's row.
   */
  isEmailTaken?: (email: string, tx?: DbExecutor) => Promise<boolean>;
  /**
   * The one lookup `resend-verification` needs, and **users only** for the
   * reason {@link create} is: `pending_verification` is a `user` status, and a
   * staff row that has not onboarded is ADR-0071 §8's flow rather than this
   * one.
   *
   * Narrower than `findByEmail` on purpose — it answers "is there an account
   * here waiting for its address to be proven?" and nothing else, so no
   * anonymous path can reach a password hash through it.
   */
  findPendingVerificationByEmail?: (
    email: string,
    tx?: DbExecutor,
  ) => Promise<MailablePrincipal | undefined>;
  /**
   * The one lookup `password/forgot` performs, and the only one here that is
   * **not** optional (ADR-0071 §4): the reset exists on both segments, so an
   * adapter that could not answer it would be an adapter whose segment silently
   * mails nobody.
   *
   * Answers `undefined` for an unknown address and for every account a link
   * must not be sent to — `pending_verification`, `invited`, `disabled`,
   * deleted — which is every case the endpoint answers `202` to.
   */
  findActiveByEmail: (
    email: string,
    tx?: DbExecutor,
  ) => Promise<MailablePrincipal | undefined>;
}

/**
 * What a federated sign-in creates (ADR-0072 §1): an account with a proven
 * address and **no password**. The status and the stamp are the adapter's to
 * write, not the caller's — see {@link FederatedAccounts.createFederated}.
 */
export interface CreateFederatedPrincipalInput {
  readonly email: string;
  readonly firstName: string | undefined;
  readonly lastName: string | undefined;
  /** When the provider's claim proved the address — `email_verified_at`. */
  readonly at: Date;
}

/** What linking writes (ADR-0072 §1, §3). */
export interface LinkFederatedIdentityInput {
  readonly userId: string;
  readonly provider: FederatedProvider;
  readonly subject: string;
  /** The address the provider reported, informational only (ADR-0072 §1). */
  readonly email: string | null;
  readonly at: Date;
}

/**
 * The account side of a sign-in with an external provider (ADR-0072 §1), and
 * **users only**: staff get no federated login (§5).
 *
 * A seam of its own rather than more optional members on {@link
 * PrincipalAdapter}, and the reason is what each is for. That adapter is the
 * ADR-0017 abstraction one auth service serves two populations through; this
 * is one population's identity table, which the staff service has no
 * business being able to type-check a call to. It is the same translation of
 * the users repository into what the auth module consumes, and it holds no
 * rule — the order a sign-in resolves in is the service's.
 */
export interface FederatedAccounts {
  /**
   * The account a provider's subject is a way into, if any.
   *
   * `principal` is `undefined` only when the identity names a row the
   * aggregate read no longer returns — unreachable while deletion releases
   * identities in the same transaction (ADR-0072 §1), and refused by the
   * caller rather than assumed away.
   */
  readonly findBySubject: (
    provider: FederatedProvider,
    subject: string,
    tx?: DbExecutor,
  ) => Promise<
    | {
        readonly identityId: string;
        readonly principal: PrincipalRecord | undefined;
      }
    | undefined
  >;
  /**
   * Inserts an `active` account with `email_verified_at` stamped, a null
   * password hash and the `customer` grant, or resolves to `undefined` when a
   * live account holds the address.
   *
   * `active` and the stamp are written **here** rather than passed in, for
   * the reason registration's `pending_verification` is: the one caller
   * creates an account on a provider's verified claim, and a status that was
   * a parameter would be a thing a second call site could get wrong.
   */
  readonly createFederated: (
    input: CreateFederatedPrincipalInput,
    tx: DbExecutor,
  ) => Promise<PrincipalRecord | undefined>;
  /**
   * Resolves to `false` when either uniqueness already holds — the subject is
   * another account's, or this account already has one of this provider.
   */
  readonly link: (
    input: LinkFederatedIdentityInput,
    tx: DbExecutor,
  ) => Promise<boolean>;
  /**
   * `last_login_at` on a sign-in through an identity already linked;
   * `false` when the row is gone — a reset removed it after it was found.
   */
  readonly touchLogin: (
    identityId: string,
    at: Date,
    tx: DbExecutor,
  ) => Promise<boolean>;
  /** The account's identities as `me` and `/user/profile` carry them (ADR-0072 §3). */
  readonly identitiesOf: (
    userId: string,
    tx?: DbExecutor,
  ) => Promise<readonly FederatedIdentityResource[]>;
  /**
   * Removes every identity of the account and resolves to the providers
   * removed (ADR-0072 §3, amended) — the reset by mail's half of "a password
   * written without the account's own authority recovers it from every way
   * in". On the caller's executor, so the identities go in the commit that
   * writes the hash or not at all.
   */
  readonly unlinkAll: (
    userId: string,
    tx: DbExecutor,
  ) => Promise<readonly FederatedProvider[]>;
  /**
   * Removes the identities of the account linked **later than** `after`, and
   * resolves to the providers removed — the session-minted reset's half
   * (ADR-0072 §3, amended after `D19.4`): what joined the account after the
   * session that asked for the link began goes, and what is older stays.
   */
  readonly unlinkLinkedAfter: (
    userId: string,
    after: Date,
    tx: DbExecutor,
  ) => Promise<readonly FederatedProvider[]>;
  /**
   * Takes the account row's lock for the rest of `tx` (ADR-0072 §3, amended
   * after `D19.4`), so a link and a reset of one account serialise rather
   * than interleave. Taken before either acts.
   */
  readonly lockAccount: (userId: string, tx: DbExecutor) => Promise<void>;
}

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
  /**
   * A login or federated exchange past `AUTH_MAX_SESSIONS_PER_PRINCIPAL`
   * revoked the principal's oldest live session (ADR-0073 §3).
   *
   * A member here since `D28.4` (`SEC-12`): it was a free literal at its one
   * call site, the only revoke path whose reason the compiler did not check.
   */
  sessionCap: "session_cap",
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
   * `AUTH_MAX_SESSIONS_PER_PRINCIPAL` (ADR-0073 §3) — how many live sessions
   * one principal may hold before a mint revokes its oldest. `0` is uncapped.
   */
  readonly maxSessionsPerPrincipal: number;
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
   * by mail removes them all (§3, amended — built at `D19.4`) or, for a
   * session-minted link, those younger than the session that asked (built at
   * `D19.5`), under the account row's lock. The staff population has no
   * federated login to answer about (§5), so its reset has nothing to remove.
   * Narrowed to the read, the lock and the removals, so this service cannot
   * reach the linking half of the seam.
   */
  readonly federated?:
    | Pick<
        FederatedAccounts,
        "identitiesOf" | "unlinkAll" | "unlinkLinkedAfter" | "lockAccount"
      >
    | undefined;
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
 * Who asked for a claimed `reset_password` link (ADR-0072 §3, amended after
 * `D19.4`): the anonymous `forgot` — the **mailbox** — or a signed-in
 * **session**, through the set-password link, which also sealed that
 * session's id.
 */
export type ResetRequest =
  | { readonly requestedBy: "mailbox" }
  | {
      readonly requestedBy: "session";
      /** `undefined` when the payload names none — read as a session that is gone. */
      readonly sessionId: string | undefined;
    };

/** A session id as the `sessions` table spells one. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads {@link ResetRequest} back out of a claimed row.
 *
 * The one fact that decides what a reset does to the account's federated
 * identities. Anything but exactly `requestedBy: "session"` — no payload,
 * which is every link `forgot` mints, or a payload that says something else —
 * reads as the mailbox alone, and the identities go: the safe direction for a
 * malformed row to fall. A session-minted payload whose session id is not a
 * UUID — absent, or written before `D19.5` sealed one — reads as a session
 * whose row is gone, which keeps nothing either; and it never reaches a
 * `uuid` column as a value Postgres would refuse with a fault.
 */
export const readResetRequest = (
  payload: Record<string, unknown> | null,
): ResetRequest => {
  if (payload?.["requestedBy"] !== "session") return { requestedBy: "mailbox" };

  const sessionId = payload["sessionId"];

  return {
    requestedBy: "session",
    sessionId:
      typeof sessionId === "string" && UUID.test(sessionId)
        ? sessionId
        : undefined,
  };
};

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

/**
 * {@link AuthServiceDeps} with the two injectables resolved.
 *
 * `createAuthService` defaults `now` and `newRefreshToken` once and hands the
 * resolved pair to every factory it composes (`D20.7`). Without it each of
 * those factories would default them again, and two halves of one service
 * would read two different clocks the moment a test injected one into the
 * outer factory alone.
 */
export type ResolvedAuthDeps = Omit<
  AuthServiceDeps,
  "now" | "newRefreshToken"
> & {
  readonly now: () => Date;
  readonly newRefreshToken: () => string;
};
