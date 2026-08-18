import { staff, type DbExecutor } from "@repo/db";
import type { StaffRole, StaffStatus } from "@repo/contracts";
import { eq } from "drizzle-orm";

/**
 * Every query against `staff` and `staff_roles` (ADR-0009).
 *
 * Step 8 needs only what authentication needs; the list, create and update
 * queries of `GET|POST|PATCH /api/v1/admin/staff` land with step 9. The layer
 * boundary is what makes that additive: a service never sees a Drizzle table,
 * so the module can grow queries without any other file learning SQL.
 *
 * Every function takes an optional `tx` so a service can compose several
 * repositories inside one `db.transaction` (ADR-0006); outside a transaction
 * it is the client itself.
 */

/**
 * A staff row plus its roles, as authentication needs it.
 *
 * `passwordHash` is present here and nowhere above this layer — the mapper
 * (ADR-0012) is what keeps it off the wire.
 */
export interface StaffAuthRecord {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly status: StaffStatus;
  readonly roles: readonly StaffRole[];
}

/** Columns of `staff` the auth path reads. `with` adds the roles. */
const authColumns = {
  id: true,
  email: true,
  passwordHash: true,
  firstName: true,
  lastName: true,
  status: true,
} as const;

const withRoles = { roles: { columns: { role: true } } } as const;

type StaffRowWithRoles = {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly status: StaffStatus;
  readonly roles: readonly { readonly role: StaffRole }[];
};

const toAuthRecord = (row: StaffRowWithRoles): StaffAuthRecord => ({
  id: row.id,
  email: row.email,
  passwordHash: row.passwordHash,
  firstName: row.firstName,
  lastName: row.lastName,
  status: row.status,
  roles: row.roles.map((grant) => grant.role),
});

export const createStaffRepository = (db: DbExecutor) =>
  ({
    /**
     * By email, case-insensitively — `email` is `citext` (ADR-0017), so no
     * `lower()` is needed and the unique index still serves the lookup.
     */
    findByEmail: async (
      email: string,
      tx: DbExecutor = db,
    ): Promise<StaffAuthRecord | undefined> => {
      const row = await tx.query.staff.findFirst({
        columns: authColumns,
        with: withRoles,
        where: eq(staff.email, email),
      });

      return row === undefined ? undefined : toAuthRecord(row);
    },

    /** By id — what `GET /auth/me` reads, so roles are re-read from the grants. */
    findById: async (
      id: string,
      tx: DbExecutor = db,
    ): Promise<StaffAuthRecord | undefined> => {
      const row = await tx.query.staff.findFirst({
        columns: authColumns,
        with: withRoles,
        where: eq(staff.id, id),
      });

      return row === undefined ? undefined : toAuthRecord(row);
    },

    /** ADR-0018 login step 5. `updatedAt` is written by the repository, not a trigger (ADR-0006). */
    updateLastLoginAt: async (
      id: string,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<void> => {
      await tx
        .update(staff)
        .set({ lastLoginAt: at, updatedAt: at })
        .where(eq(staff.id, id));
    },

    /** Transparent argon2 parameter upgrade after a successful login (ADR-0018). */
    updatePasswordHash: async (
      id: string,
      passwordHash: string,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<void> => {
      await tx
        .update(staff)
        .set({ passwordHash, updatedAt: at })
        .where(eq(staff.id, id));
    },

    // No standalone `rolesOf`: the two reads above already return the grants
    // from the same query, and a separate one would be a second round trip on
    // the login path (ADR-0017, amended step 8). Step 9's role management adds
    // the write queries it needs.
  }) as const;

export type StaffRepository = ReturnType<typeof createStaffRepository>;
