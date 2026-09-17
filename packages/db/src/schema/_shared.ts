import { customType, pgEnum, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

import {
  FEDERATED_PROVIDERS,
  GRID_DENSITIES,
  LOCALES,
  ORGANIZATION_KINDS,
  ORGANIZATION_ROLES,
  POPULATIONS,
  STAFF_ROLES,
  STAFF_STATUSES,
  THEMES,
  TOKEN_PURPOSES,
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
 * `updated_at` is stamped by **the column** on every update (ADR-0073 §8,
 * `D20.5`), through Drizzle's `$onUpdate`. Until then it was written by the
 * repository on every update (ADR-0006) — no trigger, so the schema stayed
 * portable and the mutation stayed visible in the query — and the 2026-09-13
 * review's `DB-03` is what that costs: an invariant kept only by whoever
 * remembers it, on every `update` in every repository, forever.
 *
 * `$onUpdate` is neither a trigger nor a database default. It runs in the
 * driver, so the schema is as portable as it was and the value still travels
 * in the statement where a reader can see it; what changes is that a
 * repository can no longer *omit* it. A repository that sets `updatedAt`
 * explicitly keeps working and wins — Drizzle only fills the column when the
 * `set` object does not name it — which is why the existing writes were left
 * alone rather than swept: several of them deliberately stamp a row and one
 * of its neighbours with the *same* instant.
 *
 * It fires on `db.update(...)` and nowhere else. A raw `UPDATE` through
 * `db.execute` bypasses it exactly as it bypasses every other Drizzle
 * behaviour, and a database-side trigger would be the only way to cover that.
 * No repository here updates a row that way, and the door to a
 * trigger stays open: nothing depends on the value being computed in the
 * driver, so moving it into the database later is a migration and not a
 * change of meaning.
 */
export const timestamps = () => ({
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
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
 * Who an audit row attributes an event to (ADR-0058) — the same two labels as
 * {@link principalTypeEnum} and deliberately **not** that type.
 *
 * `principal_type` describes a live session; this describes a recorded fact
 * that outlives every session and every account it names. Sharing one Postgres
 * enum would tie them: the day an audit actor needs a third label (a scheduled
 * job, an operator at the console), `ALTER TYPE … ADD VALUE` would widen the
 * `sessions` column too, and `sessions` has no such value and never will
 * (ADR-0010 refuses a `system` principal by design). Two types, one tuple.
 */
export const auditActorTypeEnum = pgEnum("audit_actor_type", POPULATIONS);

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
/**
 * How tightly a grid packs its rows (`D11.6`, ADR-0053 §2, ADR-0054 §6).
 *
 * A column and a type rather than a key in the `grids` jsonb, which is what
 * ADR-0053 first said and amended at `D11.6`: `grids` is a per-grid map and a
 * row-wide mode has nowhere to sit in it. Complete as it stands — the mode is
 * two values by decision, and a third rung would be a different control.
 */
export const gridDensityEnum = pgEnum("grid_density", GRID_DENSITIES);

/**
 * The organization enums (ADR-0067 §2), built from the `@repo/contracts`
 * tuples like every other one here.
 *
 * `organization_role` is deliberately **not** `user_role`, although both name
 * what somebody is allowed to do. A user role is a property of the account
 * across the whole system; a membership role is a property of one (account,
 * organization) pair, and the day `user_role` grows `premium` that value must
 * not become something a membership can hold. Two types, two tuples.
 *
 * There is no `invitation_status` type: an invitation's state is read from its
 * timestamps, and `expired` is the state no column can hold — it becomes true
 * as the clock passes `expires_at`, with no row written (ADR-0067 §2, and
 * `INVITATION_STATUSES` in `@repo/contracts` says the same in place).
 */
export const organizationKindEnum = pgEnum(
  "organization_kind",
  ORGANIZATION_KINDS,
);
export const organizationRoleEnum = pgEnum(
  "organization_role",
  ORGANIZATION_ROLES,
);

/**
 * What a row of `account_tokens` is for (ADR-0071 §1), built from the
 * `@repo/contracts` tuple like every other one here.
 *
 * Deliberately **not** `principal_type`-adjacent and deliberately not widened
 * to cover the organization invitation: that row lives in its own table with
 * its own `token_hash` because it carries organization state a generic row
 * does not (ADR-0067 §2). The enum is expected to grow — a fifth flow is a
 * fifth label and an `ALTER TYPE … ADD VALUE`, which appends, so no row and no
 * sort order moves.
 */
export const tokenPurposeEnum = pgEnum("token_purpose", TOKEN_PURPOSES);

/**
 * Which external provider a row of `federated_identities` belongs to
 * (ADR-0072 §1), built from the `@repo/contracts` tuple like every other one
 * here. One label today; a second provider is an appended label and an
 * adapter, and nothing in the table names Google.
 */
export const federatedProviderEnum = pgEnum(
  "federated_provider",
  FEDERATED_PROVIDERS,
);
