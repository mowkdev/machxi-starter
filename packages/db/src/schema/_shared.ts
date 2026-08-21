import { customType, pgEnum, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

import {
  LOCALES,
  POPULATIONS,
  STAFF_ROLES,
  STAFF_STATUSES,
  THEMES,
  USER_ROLES,
  USER_STATUSES,
} from "@repo/contracts";

/**
 * Column helpers and shared enums (ADR-0006).
 *
 * Everything a table needs but should not re-describe: the primary key, the
 * `created_at`/`updated_at` pair, the case-insensitive email type, and the
 * Postgres enums. Physical column names are `snake_case` and are produced by
 * Drizzle's `casing: 'snake_case'` setting, not spelled out per column.
 */

/**
 * `citext` — case-insensitive text (ADR-0017). Postgres has no built-in for
 * it, so the type is declared here and the extension is installed by migration
 * `0000` (ADR-0008); the test database and CI get it from the same migration.
 *
 * A unique index on a `citext` column is what makes `Ada@example.com` and
 * `ada@example.com` the same account, without any `lower()` in the queries.
 */
export const citext = customType<{ data: string; driverData: string }>({
  dataType: () => "citext",
});

/**
 * The primary key of every table: `uuid`, generated **app-side** as UUIDv7
 * (ADR-0006). Time-ordered, so inserts land at the right edge of the B-tree
 * instead of scattering it, and safe to expose in a URL.
 *
 * `$defaultFn` runs in the driver, which means a repository can read the id it
 * is about to insert; a `default gen_random_uuid()` in the database could not
 * offer that and would be v4 besides.
 */
export const primaryId = () => uuid().primaryKey().$defaultFn(uuidv7);

/**
 * `created_at` / `updated_at`, both `timestamptz not null default now()`.
 *
 * `updated_at` is written by the repository on every update (ADR-0006) — no
 * trigger, so the schema stays portable and the mutation is visible in the
 * query rather than hidden in the database.
 */
export const timestamps = () => ({
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * The Postgres enums (ADR-0017), each built from the single `as const` tuple
 * in `@repo/contracts` (ADR-0023) so the database, request validation and the
 * clients cannot drift apart.
 *
 * **Declaration order is the sort order.** Postgres orders an enum column by
 * label position, so `ORDER BY status` on a list endpoint (ADR-0014) follows
 * the order of the arrays in `@repo/contracts`. Reordering one of those arrays
 * is a schema change; adding a value is `ALTER TYPE … ADD VALUE`, which
 * appends.
 */
export const staffRoleEnum = pgEnum("staff_role", STAFF_ROLES);
export const staffStatusEnum = pgEnum("staff_status", STAFF_STATUSES);
export const userRoleEnum = pgEnum("user_role", USER_ROLES);
export const userStatusEnum = pgEnum("user_status", USER_STATUSES);

/**
 * Discriminates which population a session belongs to (ADR-0018). One
 * `sessions` table serves both, so this column plus `principal_id` stands in
 * for a foreign key that Postgres cannot express polymorphically.
 */
export const principalTypeEnum = pgEnum("principal_type", POPULATIONS);

/**
 * The settings enums (ADR-0045), built from the `@repo/contracts` tuples like
 * every other one here — one type per fact, shared by both settings tables.
 *
 * `locale` is the one enum in this schema expected to grow: D7 appends `"lv"`
 * to `LOCALES` and writes the `ALTER TYPE … ADD VALUE`, which appends, so no
 * row and no sort order moves. `theme` is complete as it stands; `"system"` is
 * the deferral to `prefers-color-scheme`, stored as a value rather than as the
 * absence of one, so a client can tell "follow the device" from "never said".
 */
export const themeEnum = pgEnum("theme", THEMES);
export const localeEnum = pgEnum("locale", LOCALES);
