import { relations } from "drizzle-orm";
import { jsonb, pgTable, uuid } from "drizzle-orm/pg-core";

import {
  DEFAULT_GRID_DENSITY,
  DEFAULT_LOCALE,
  DEFAULT_THEME,
  type GridPreferencesV1,
} from "@repo/contracts";

import {
  gridDensityEnum,
  localeEnum,
  primaryId,
  themeEnum,
  timestamps,
} from "./_shared.js";
import { staff } from "./staff.js";
import { users } from "./users.js";

/**
 * Per-account display settings (ADR-0045) — theme, locale and how this
 * principal likes each grid arranged.
 *
 * **A settings row is display state and nothing else**: column ids and widths,
 * a theme, a locale. Never row data, never a filter value, never anything
 * typed into a grid. That is ADR-0041's line restated for the server, and the
 * shape below is what makes it structural — there is no column such a thing
 * could live in.
 *
 * **Two tables, column-for-column identical today, by decision.** The obvious
 * alternative is the `sessions` shape: one table with a `principal_type`
 * discriminator. `sessions.ts` is honest about what that costs — Postgres
 * cannot express a polymorphic foreign key, so `principal_id` carries none and
 * the service sweeps sessions by hand when a principal goes. Settings have a
 * choice sessions did not, and two facts take it the other way. A settings row
 * **can** have a real foreign key if each population owns a table, so the
 * database does the sweeping and no hard-delete path added later can forget
 * to. And the two populations' settings are the kind of thing that diverges —
 * an operator's panel and a customer's app want different knobs — which is
 * exactly the divergence ADR-0017 refused to host in one `accounts` table: a
 * discriminated table diverges by sprouting nullable columns one population
 * never fills, and at that point it is two tables pretending to be one.
 *
 * The price is one more migration file and nothing in the service, which picks
 * a repository half by `ctx.principal.kind` and never branches again.
 */

/**
 * The settings columns both tables carry — everything except the principal
 * reference, which is the one column that differs and the reason there are two
 * tables at all.
 *
 * A function rather than a shared object because Drizzle's column builders are
 * stateful: two tables spreading one object would share them. Spread into each
 * table below rather than hidden behind a table factory, so the pair still
 * reads as two tables — the day one of them gains a column is the day this
 * helper stops covering it, and that day should be a small edit rather than an
 * unpicking.
 */
const settingsColumns = () => ({
  /** `"system"` means the media query, resolved by the client at apply time. */
  theme: themeEnum().notNull().default(DEFAULT_THEME),
  locale: localeEnum().notNull().default(DEFAULT_LOCALE),
  /**
   * How tightly a grid packs its rows (`D11.6`, ADR-0053 §2).
   *
   * One row-wide mode, not one per grid: an operator who likes tight rows
   * likes them on every screen, and a per-grid copy would be the same
   * preference stored `n` times with nothing keeping the copies equal.
   */
  gridDensity: gridDensityEnum().notNull().default(DEFAULT_GRID_DENSITY),
  /**
   * `gridId` → arrangement, `{}` for a principal who has never touched one.
   *
   * The one column whose shape the database does not check, and it does not
   * need to: every value that reaches it has passed `gridPreferencesSchema` in
   * the request body, and every value that leaves it passes the same schema in
   * the client store. The server stores what it validated and returns what it
   * stored.
   */
  grids: jsonb()
    .$type<Record<string, GridPreferencesV1>>()
    .notNull()
    .default({}),
  ...timestamps(),
});

/**
 * A staff member's settings. **No row means defaults** — nothing creates one
 * at staff creation or at login, the first `PATCH` upserts it, and `GET`
 * answers the same resource either way, so nothing downstream can tell the two
 * apart.
 */
export const staffSettings = pgTable("staff_settings", {
  id: primaryId(),
  /**
   * One row per staff member: the `unique` is what makes "this principal's
   * settings" a single row and the upsert a single statement.
   *
   * `cascade` is the whole of ADR-0045's deletion story. Hard-deleting a staff
   * account (ADR-0028 §Staff) takes the settings row with it in the same
   * statement, so the staff service needs no settings dependency and no future
   * hard-delete path can forget the sweep.
   *
   * The constraint is named, for the reason `sessions.ts` gives: an unnamed
   * `.unique()` takes the **TypeScript** property name, and
   * `staff_settings_staffId_unique` would be a camelCase identifier in an
   * otherwise snake_case database.
   */
  staffId: uuid()
    .notNull()
    .unique("staff_settings_staff_id_unique")
    .references(() => staff.id, { onDelete: "cascade" }),
  ...settingsColumns(),
});

/**
 * A customer's settings. Users are **soft**-deleted (ADR-0028), so this row
 * survives a deletion because the `users` row does: the account is retained by
 * design, and a restore path should find the arrangement still there.
 */
export const userSettings = pgTable("user_settings", {
  id: primaryId(),
  userId: uuid()
    .notNull()
    .unique("user_settings_user_id_unique")
    .references(() => users.id, { onDelete: "cascade" }),
  ...settingsColumns(),
});

export const staffSettingsRelations = relations(staffSettings, ({ one }) => ({
  staff: one(staff, {
    fields: [staffSettings.staffId],
    references: [staff.id],
  }),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, {
    fields: [userSettings.userId],
    references: [users.id],
  }),
}));
