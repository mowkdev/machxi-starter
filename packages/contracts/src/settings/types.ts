import type { Locale, Theme } from "./enums.js";

/**
 * The settings resources as the API returns them (ADR-0012 §Resource shape
 * rules, ADR-0045 §Contracts).
 *
 * **No `id` and no timestamps.** The subject is the principal, which the
 * caller already is, and `updatedAt` would answer a question nothing asks —
 * ADR-0012 requires ISO timestamps *where they appear*, not that they appear.
 */

/**
 * One grid's arrangement as it is stored and returned — the output of
 * `gridPreferencesSchema`, hand-written here because it is part of a resource
 * and readonly for the same reason every other resource type is.
 */
export interface GridPreferencesV1 {
  readonly v: 1;
  /** Column id → px. An absent id means "whatever the content needs". */
  readonly sizing: Readonly<Record<string, number>>;
  /** Every movable column, in render order. */
  readonly order: readonly string[];
  /** The movable columns currently hidden. */
  readonly hidden: readonly string[];
}

/**
 * What a settings row says, for either population. **Display state and nothing
 * else** — column ids and widths, a theme, a locale. Never row data, never a
 * filter value, never anything typed into a grid: that is ADR-0041's line
 * restated for the server, and it is a structural fact here rather than a
 * review item, because the type has no field such a thing could live in.
 */
interface SettingsCore {
  readonly theme: Theme;
  readonly locale: Locale;
  /** `gridId` → arrangement. `{}` for a principal who has never touched one. */
  readonly grids: Readonly<Record<string, GridPreferencesV1>>;
}

/**
 * `GET`/`PATCH /api/v1/admin/settings`.
 *
 * The same shape as {@link UserSettingsResource} today, and that is a fact
 * about today: **the pair is the split point.** When a customer setting
 * arrives that staff have no use for — or the reverse — it is added to one
 * export, the matching table gains the column, and that population's service
 * function splits off the shared one. Two names for one shape now, rather than
 * one name and a rename later.
 */
export type StaffSettingsResource = SettingsCore;

/** `GET`/`PATCH /api/v1/user/settings`. See {@link StaffSettingsResource}. */
export type UserSettingsResource = SettingsCore;
