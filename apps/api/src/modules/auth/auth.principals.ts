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
  roles: row.roles,
  resource: toStaffPrincipalResource(row),
});

/**
 * `pending_verification` is deliberately *not* active: v1 self-registration
 * creates users as `active`, so a row in that state was put there on purpose
 * and must not be able to log in until the future verification flow clears it.
 */
const userRecord = (
  row: Parameters<typeof toUserPrincipalResource>[0],
): PrincipalRecord => ({
  id: row.id,
  email: row.email,
  passwordHash: row.passwordHash,
  active: row.status === "active",
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

  /**
   * Insert plus the `customer` grant. Both run on the executor the service
   * passes, so registration's insert, grant and session row commit or fail
   * together — a user with no role would pass every guard that only checks
   * authentication and fail every one that checks a role.
   */
  create: async (input, tx): Promise<PrincipalRecord | undefined> => {
    const created = await repository.create(input, tx);

    if (created === undefined) return undefined;

    await repository.grantRole(created.id, "customer", tx);

    return userRecord({ ...created, roles: ["customer"] });
  },
});
