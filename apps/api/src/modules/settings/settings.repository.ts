import type { GridPreferencesV1, Locale, Theme } from "@repo/contracts";
import {
  staffSettings,
  userSettings,
  type DbExecutor,
  type Db,
} from "@repo/db";
import { eq } from "drizzle-orm";

import { internal } from "../../core/errors/index.js";

/**
 * Every query against `staff_settings` and `user_settings` (ADR-0009,
 * ADR-0045).
 *
 * **Two tables, one signature, built twice.** The tables are separate
 * aggregates on purpose — a settings row carries a real foreign key to its
 * principal, which `sessions` could not have — and they are column-for-column
 * identical today. So the query code is written once against a description of
 * a table and instantiated per population; the service picks a half by
 * `ctx.principal.kind` and never branches again. The day a customer setting
 * arrives that staff have no use for, this is where the halves stop sharing.
 */

/** A settings row as every read returns it. No `id`: nothing above reads one. */
export interface SettingsRecord {
  readonly theme: Theme;
  readonly locale: Locale;
  readonly grids: Record<string, GridPreferencesV1>;
}

/** What a write puts in the row — the whole of it, after the merge. */
export interface SettingsWrite {
  readonly theme: Theme;
  readonly locale: Locale;
  readonly grids: Record<string, GridPreferencesV1>;
}

/** One population's half. Both halves answer to this, for both tables. */
export interface SettingsTableRepository {
  /** `GET /settings`. `undefined` means "no row", which the mapper reads as the defaults. */
  readonly findByPrincipal: (
    principalId: string,
    tx?: DbExecutor,
  ) => Promise<SettingsRecord | undefined>;
  /**
   * The row this principal is about to have merged into, locked for the rest
   * of the transaction — creating it first if it does not exist yet.
   */
  readonly lockForUpdate: (
    principalId: string,
    tx: DbExecutor,
  ) => Promise<SettingsRecord>;
  /** Writes the merged row back and returns what the database now holds. */
  readonly save: (
    principalId: string,
    next: SettingsWrite,
    tx: DbExecutor,
  ) => Promise<SettingsRecord>;
}

/**
 * What differs between the two halves: the table, and which column points at
 * the principal. Everything below is written against this and nothing else.
 */
interface TableSpec {
  readonly table: typeof staffSettings | typeof userSettings;
  readonly principalColumn:
    typeof staffSettings.staffId | typeof userSettings.userId;
  /**
   * The insert values naming the principal, supplied per half rather than
   * derived from {@link TableSpec.principalColumn}.
   *
   * `principalColumn.name` is the **physical** name (`staff_id`), and
   * `.values()` takes the TypeScript property (`staffId`) — a computed key
   * built from the column would type-check, because the key widens to
   * `string`, and insert a row where the principal column was never set. A
   * closure per half cannot be spelled wrongly without failing to compile.
   */
  readonly newRow: (principalId: string) => Record<string, string>;
}

const createTableRepository = (
  db: Db,
  { table, principalColumn, newRow }: TableSpec,
): SettingsTableRepository => {
  const columns = {
    theme: table.theme,
    locale: table.locale,
    grids: table.grids,
  } as const;

  return {
    findByPrincipal: async (principalId, tx = db) => {
      const [row] = await tx
        .select(columns)
        .from(table)
        .where(eq(principalColumn, principalId));

      return row;
    },

    /**
     * **Create-then-lock, rather than lock-or-nothing.**
     *
     * `select … for update` locks the rows it finds, and a principal's first
     * ever `PATCH` finds none — so two of them race: both read "no settings",
     * both compute a merge from nothing, and the second write erases the
     * first's grids. That is precisely the outcome per-key merging exists to
     * prevent, arriving through the one case the merge cannot see.
     *
     * Inserting the defaults row first closes it without a retry loop and
     * without an advisory lock. `on conflict do nothing` makes the insert a
     * no-op when the row is already there, and when a concurrent transaction
     * has inserted but not committed, Postgres makes this statement *wait* for
     * it — so by the time the lock is taken there is exactly one row and the
     * second transaction reads what the first actually wrote.
     *
     * A `PATCH` that then fails its bound leaves no row behind: the insert is
     * inside the caller's transaction and rolls back with it.
     */
    lockForUpdate: async (principalId, tx) => {
      await tx.insert(table).values(newRow(principalId)).onConflictDoNothing();

      const [row] = await tx
        .select(columns)
        .from(table)
        .where(eq(principalColumn, principalId))
        .for("update");

      if (row === undefined) {
        // Unreachable: the insert above guarantees the row, and the lock is
        // held for the rest of the transaction. Loud rather than a `!`,
        // because the alternative is a merge against a silently empty row.
        throw internal("Settings row vanished between insert and lock");
      }

      return row;
    },

    save: async (principalId, next, tx) => {
      const [row] = await tx
        .update(table)
        .set({
          theme: next.theme,
          locale: next.locale,
          grids: next.grids,
          updatedAt: new Date(),
        })
        .where(eq(principalColumn, principalId))
        .returning(columns);

      if (row === undefined) {
        throw internal("Settings row vanished before its update");
      }

      return row;
    },
  } as const;
};

/**
 * The pair, keyed by population so that `repository[ctx.principal.kind]` is
 * the only place a request's population becomes a table (ADR-0045).
 */
export const createSettingsRepository = (db: Db) =>
  ({
    staff: createTableRepository(db, {
      table: staffSettings,
      principalColumn: staffSettings.staffId,
      newRow: (staffId) => ({ staffId }),
    }),
    user: createTableRepository(db, {
      table: userSettings,
      principalColumn: userSettings.userId,
      newRow: (userId) => ({ userId }),
    }),
  }) as const;

export type SettingsRepository = ReturnType<typeof createSettingsRepository>;
