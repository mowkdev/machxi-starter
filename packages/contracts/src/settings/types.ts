import type { z } from "zod";

import type { Locale, Theme } from "./enums.js";
import type { gridPreferencesSchema } from "./schemas.js";

/**
 * The settings resources as the API returns them (ADR-0012 §Resource shape
 * rules, ADR-0045 §Contracts).
 *
 * **No `id` and no timestamps.** The subject is the principal, which the
 * caller already is, and `updatedAt` would answer a question nothing asks —
 * ADR-0012 requires ISO timestamps *where they appear*, not that they appear.
 */

/**
 * One grid's arrangement as it is stored and returned: `v`, `sizing` (column
 * id → px), `order` (every movable column, in render order) and `hidden`.
 *
 * **Derived from the schema rather than hand-written**, which is the one place
 * this package departs from writing resource types by hand — and it departs
 * because this type is on **both** sides of the wire. It is the value in the
 * resource's `grids` and the value in the `PATCH` body's `grids`, so a
 * hand-written twin would have to agree with the schema exactly or a caller
 * could not put back what it was given. The first attempt was hand-written and
 * they did not agree: zod infers mutable arrays, the interface declared
 * `readonly string[]`, and a value read from a resource could not be sent in a
 * patch. One declaration cannot drift from itself.
 *
 * `Readonly` is applied where the type is *used* — on the record in
 * {@link SettingsCore} — rather than inside it, so the resource still refuses
 * to be mutated where that costs nothing.
 */
export type GridPreferencesV1 = z.infer<typeof gridPreferencesSchema>;

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
