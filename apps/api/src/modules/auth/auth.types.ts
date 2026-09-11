import type {
  FederatedIdentityResource,
  FederatedProvider,
  Population,
  PrincipalResource,
  Role,
} from "@repo/contracts";
import type { DbExecutor } from "@repo/db";

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
  /** `last_login_at` on a sign-in through an identity already linked. */
  readonly touchLogin: (
    identityId: string,
    at: Date,
    tx: DbExecutor,
  ) => Promise<void>;
  /** The account's identities as `me` and `/user/profile` carry them (ADR-0072 §3). */
  readonly identitiesOf: (
    userId: string,
    tx?: DbExecutor,
  ) => Promise<readonly FederatedIdentityResource[]>;
}
