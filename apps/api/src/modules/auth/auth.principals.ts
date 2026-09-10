import type { StaffRepository } from "../staff/staff.repository.js";
import type { UsersRepository } from "../users/users.repository.js";
import {
  toStaffPrincipalResource,
  toUserPrincipalResource,
} from "./auth.mapper.js";
import type { PrincipalAdapter, PrincipalRecord } from "./auth.types.js";

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

  // No `create`: staff cannot self-register (ADR-0017 §Invariants). They are
  // created by an admin through `POST /api/v1/admin/staff` in step 9.
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
