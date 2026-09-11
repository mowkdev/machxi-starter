import type { StaffRepository } from "../staff/staff.repository.js";
import { toFederatedIdentityResource } from "../users/users.mapper.js";
import type { UsersRepository } from "../users/users.repository.js";
import {
  toStaffPrincipalResource,
  toUserPrincipalResource,
} from "./auth.mapper.js";
import type {
  FederatedAccounts,
  PrincipalAdapter,
  PrincipalRecord,
} from "./auth.types.js";

/**
 * The two population adapters (ADR-0017 §Principal abstraction in code).
 *
 * Each is a thin translation of one repository into the shape
 * `createAuthService` consumes. They hold no logic beyond that translation —
 * anything that looks like a rule (equal-timing verification, rotation, reuse
 * detection) belongs to the service, or it would have to be written twice.
 */

/**
 * `active` is the only staff status that may sign in (ADR-0017): `invited` has
 * no usable password yet and `disabled` is the whole point of the column.
 */
const staffRecord = (
  row: Parameters<typeof toStaffPrincipalResource>[0],
): PrincipalRecord => ({
  id: row.id,
  email: row.email,
  passwordHash: row.passwordHash,
  active: row.status === "active",
  // Never true for staff (ADR-0071 §8): an `invited` operator is waiting for a
  // password, not for a mailbox to be proven, and login refuses that row as it
  // refuses any inactive one.
  awaitingEmailVerification: false,
  roles: row.roles,
  resource: toStaffPrincipalResource(row),
});

/**
 * `pending_verification` is not active, and since ADR-0071 §3 it is not the
 * same refusal either: self-registration puts every new account in that state,
 * the verification link is what clears it, and login answers a *correct*
 * password on such a row with `403 AUTH_EMAIL_UNVERIFIED` rather than the
 * `AUTH_ACCOUNT_DISABLED` a `disabled` row gets. The distinction is drawn
 * here, where the status is, and travels to the service as a boolean.
 */
const userRecord = (
  row: Parameters<typeof toUserPrincipalResource>[0],
): PrincipalRecord => ({
  id: row.id,
  email: row.email,
  passwordHash: row.passwordHash,
  active: row.status === "active",
  awaitingEmailVerification: row.status === "pending_verification",
  roles: row.roles,
  resource: toUserPrincipalResource(row),
});

export const createStaffPrincipalAdapter = (
  repository: StaffRepository,
): PrincipalAdapter<"staff"> => ({
  population: "staff",

  findByEmail: async (email, tx) => {
    const row = await repository.findByEmail(email, tx);

    return row === undefined ? undefined : staffRecord(row);
  },

  findById: async (id, tx) => {
    const row = await repository.findById(id, tx);

    return row === undefined ? undefined : staffRecord(row);
  },

  touchLastLogin: repository.updateLastLoginAt,
  updatePasswordHash: repository.updatePasswordHash,
  findActiveByEmail: repository.findActiveByEmail,

  /**
   * The onboarding link's effect (ADR-0071 §8), and the roles come back with
   * it because the session minted a moment later is built from them —
   * `activateVerified`'s reason on the users side.
   *
   * The repository's `where` is what makes this safe rather than a check here:
   * only an `invited` row moves, so a second accept finds nothing and is
   * refused with the token's claim rolled back.
   */
  activateOnboarded: async (
    id,
    passwordHash,
    at,
    tx,
  ): Promise<PrincipalRecord | undefined> => {
    const updated = await repository.activateOnboarded(
      id,
      passwordHash,
      at,
      tx,
    );

    return updated === undefined ? undefined : staffRecord(updated);
  },

  // No `create`: staff cannot self-register (ADR-0017 §Invariants). They are
  // created by an admin through `POST /api/v1/admin/staff`, which since
  // ADR-0071 §8 may create the row `invited` and mail the link this consumes.
});

export const createUserPrincipalAdapter = (
  repository: UsersRepository,
): PrincipalAdapter<"user"> => ({
  population: "user",

  findByEmail: async (email, tx) => {
    const row = await repository.findByEmail(email, tx);

    return row === undefined ? undefined : userRecord(row);
  },

  findById: async (id, tx) => {
    const row = await repository.findById(id, tx);

    return row === undefined ? undefined : userRecord(row);
  },

  touchLastLogin: repository.updateLastLoginAt,
  updatePasswordHash: repository.updatePasswordHash,
  findActiveByEmail: repository.findActiveByEmail,

  /**
   * Insert plus the `customer` grant. Both run on the executor the service
   * passes, so registration's insert, grant and its token row commit or fail
   * together — a user with no role would pass every guard that only checks
   * authentication and fail every one that checks a role.
   *
   * **`pending_verification`, and the status is written here rather than
   * passed in** (ADR-0071 §3). Self-registration is this function's only
   * caller, and the account it creates has proven nothing: the address is a
   * string somebody typed, and the link is what turns it into a fact. Leaving
   * the status to a parameter would make "a registration can create an
   * `active` account" a thing one call site could decide, which is exactly the
   * invariant §3 buys — every `active` user has a proven address.
   */
  create: async (input, tx): Promise<PrincipalRecord | undefined> => {
    const created = await repository.create(
      { ...input, status: "pending_verification" },
      tx,
    );

    if (created === undefined) return undefined;

    await repository.grantRole(created.id, "customer", tx);

    return userRecord({ ...created, roles: ["customer"] });
  },

  /**
   * The verification link's effect (ADR-0071 §3), and the roles come back with
   * it because the session minted a moment later is built from them.
   */
  activateVerified: async (
    id,
    at,
    tx,
  ): Promise<PrincipalRecord | undefined> => {
    const updated = await repository.markEmailVerified(id, at, tx);

    return updated === undefined ? undefined : userRecord(updated);
  },

  /**
   * The address change's write (ADR-0071 §6), and the roles come back with it
   * for `activateVerified`'s reason: every `PrincipalRecord` carries the
   * grants, whether or not this particular caller mints a session from them.
   */
  changeEmailVerified: async (
    id,
    email,
    at,
    tx,
  ): Promise<PrincipalRecord | undefined> => {
    const updated = await repository.updateEmailVerified(id, email, at, tx);

    return updated === undefined ? undefined : userRecord(updated);
  },

  isEmailTaken: repository.emailTaken,

  findPendingVerificationByEmail: repository.findPendingVerificationByEmail,
});

/**
 * The users repository as a federated sign-in consumes it (ADR-0072 §1) — the
 * seam {@link FederatedAccounts} names, and a translation like the two above
 * with no rule of its own.
 */
export const createFederatedAccounts = (
  repository: UsersRepository,
): FederatedAccounts => ({
  findBySubject: async (provider, subject, tx) => {
    const identity = await repository.findIdentityBySubject(
      provider,
      subject,
      tx,
    );

    if (identity === undefined) return undefined;

    const row = await repository.findById(identity.userId, tx);

    return {
      identityId: identity.id,
      principal: row === undefined ? undefined : userRecord(row),
    };
  },

  /**
   * `active`, the address stamped, **no password**, and the `customer`
   * grant, on the caller's executor so the account, its grant, its personal
   * organization and its identity commit together (ADR-0072 §1, ADR-0067 §2).
   *
   * The provider's verified claim is the proof `email_verified_at` records —
   * the same kind of assertion `POST /admin/users` makes when a staff member
   * types an address (ADR-0071 §3) — so the invariant every `active` user has
   * a proven address holds on this path too.
   */
  createFederated: async (input, tx) => {
    const created = await repository.create(
      {
        email: input.email,
        passwordHash: null,
        firstName: input.firstName,
        lastName: input.lastName,
        status: "active",
        emailVerifiedAt: input.at,
      },
      tx,
    );

    if (created === undefined) return undefined;

    await repository.grantRole(created.id, "customer", tx);

    return userRecord({ ...created, roles: ["customer"] });
  },

  link: repository.linkIdentity,
  touchLogin: repository.touchIdentityLogin,

  identitiesOf: async (userId, tx) =>
    (await repository.identitiesOf([userId], tx)).map(
      toFederatedIdentityResource,
    ),

  unlinkAll: (userId, tx) => repository.unlinkIdentities(userId, tx),
  unlinkLinkedAfter: (userId, after, tx) =>
    repository.unlinkIdentities(userId, tx, after),
  lockAccount: repository.lockById,
});
