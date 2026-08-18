import { userRoles, users, type DbExecutor } from "@repo/db";
import type { UserRole, UserStatus } from "@repo/contracts";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Every query against `users` and `user_roles` (ADR-0009).
 *
 * The mirror of `staff.repository.ts`, and deliberately a separate file rather
 * than one parameterised helper: the two tables differ exactly where it
 * matters (nullable names, nullable `password_hash`, soft delete), and a
 * generic "principal repository" would have to erase those differences to
 * exist. What *is* shared is the shape the auth service consumes — the
 * `PrincipalAdapter` in the auth module (ADR-0017).
 */

/** A user row plus its roles, as authentication needs it. */
export interface UserAuthRecord {
  readonly id: string;
  readonly email: string;
  /**
   * `null` for an account with no password login (ADR-0017). The auth service
   * must read that as "this account cannot sign in with a password", never as
   * "any password matches".
   */
  readonly passwordHash: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly status: UserStatus;
  readonly roles: readonly UserRole[];
}

const authColumns = {
  id: true,
  email: true,
  passwordHash: true,
  firstName: true,
  lastName: true,
  status: true,
} as const;

const withRoles = { roles: { columns: { role: true } } } as const;

type UserRowWithRoles = {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly status: UserStatus;
  readonly roles: readonly { readonly role: UserRole }[];
};

const toAuthRecord = (row: UserRowWithRoles): UserAuthRecord => ({
  id: row.id,
  email: row.email,
  passwordHash: row.passwordHash,
  firstName: row.firstName,
  lastName: row.lastName,
  status: row.status,
  roles: row.roles.map((grant) => grant.role),
});

/** What registration inserts (ADR-0018 §Staff onboarding). */
export interface NewUserInput {
  readonly email: string;
  readonly passwordHash: string;
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
}

export const createUsersRepository = (db: DbExecutor) =>
  ({
    /**
     * By email, excluding soft-deleted rows.
     *
     * `deleted_at is not null` means the account is gone as far as every
     * caller is concerned; returning it here would let a deleted user log in.
     */
    findByEmail: async (
      email: string,
      tx: DbExecutor = db,
    ): Promise<UserAuthRecord | undefined> => {
      const row = await tx.query.users.findFirst({
        columns: authColumns,
        with: withRoles,
        where: and(eq(users.email, email), isNull(users.deletedAt)),
      });

      return row === undefined ? undefined : toAuthRecord(row);
    },

    findById: async (
      id: string,
      tx: DbExecutor = db,
    ): Promise<UserAuthRecord | undefined> => {
      const row = await tx.query.users.findFirst({
        columns: authColumns,
        with: withRoles,
        where: and(eq(users.id, id), isNull(users.deletedAt)),
      });

      return row === undefined ? undefined : toAuthRecord(row);
    },

    /**
     * Inserts the account, or resolves to `undefined` when the email is taken.
     *
     * `onConflictDoNothing` rather than a prior `select`: two concurrent
     * registrations of the same address would both find nothing and both
     * insert, and the second would surface as an unhandled unique violation.
     * The caller turns `undefined` into a generic `409` that does not confirm
     * the address (ADR-0020 §Enumeration).
     */
    create: async (
      input: NewUserInput,
      tx: DbExecutor = db,
    ): Promise<UserAuthRecord | undefined> => {
      const [created] = await tx
        .insert(users)
        .values({
          email: input.email,
          passwordHash: input.passwordHash,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          // v1 self-registration starts active; `pending_verification` waits
          // for the email-verification feature (ADR-0017).
          status: "active",
        })
        .onConflictDoNothing({ target: users.email })
        .returning({
          id: users.id,
          email: users.email,
          passwordHash: users.passwordHash,
          firstName: users.firstName,
          lastName: users.lastName,
          status: users.status,
        });

      if (created === undefined) return undefined;

      return { ...created, roles: [] };
    },

    /** Idempotent grant; the composite primary key makes a repeat a no-op. */
    grantRole: async (
      userId: string,
      role: UserRole,
      tx: DbExecutor = db,
    ): Promise<void> => {
      await tx.insert(userRoles).values({ userId, role }).onConflictDoNothing();
    },

    updateLastLoginAt: async (
      id: string,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<void> => {
      await tx
        .update(users)
        .set({ lastLoginAt: at, updatedAt: at })
        .where(eq(users.id, id));
    },

    updatePasswordHash: async (
      id: string,
      passwordHash: string,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<void> => {
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: at })
        .where(eq(users.id, id));
    },

    // No standalone `rolesOf` — see the note in `staff.repository.ts`.
  }) as const;

export type UsersRepository = ReturnType<typeof createUsersRepository>;
