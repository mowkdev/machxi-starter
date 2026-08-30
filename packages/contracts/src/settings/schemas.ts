import { z } from "zod";

import { GRID_DENSITIES, LOCALES, THEMES } from "./enums.js";

/**
 * Request schemas for the settings module (ADR-0045). One module serves both
 * segments — `/api/v1/admin/settings` and `/api/v1/user/settings` — and every
 * handler reads its subject from `ctx.principal`, so there is no `:id` params
 * schema here and nothing for a caller to point at another account.
 *
 * The body is a **merge**, not a replacement: every key is optional, the
 * scalars — `theme`, `locale` and, since `D11.6`, `gridDensity` — replace when
 * present, and `grids` is applied entry by entry.
 * That is what makes a body a statement about the keys it names and silence
 * about the rest — and silence cannot erase anything, which is the property a
 * `PUT` of the whole document could not offer two open tabs (ADR-0045
 * §Alternatives).
 */

/**
 * The bounds, exported because three places need them: the schemas below, the
 * service's check on the *merged* row (which a body cannot make), and the
 * admin grid's own width clamp.
 */
export const MIN_COLUMN_WIDTH = 64;
export const MAX_COLUMN_WIDTH = 2_000;
/** More columns than any grid this vocabulary can describe will ever have. */
export const MAX_GRID_COLUMNS = 200;
/** More grids than an operator has screens; the stored row's ceiling. */
export const MAX_SETTINGS_GRIDS = 50;

/**
 * A column id, bounded — it is a config key, not free text.
 *
 * The bound is what stops a crafted entry turning the admin's Columns menu
 * into something that cannot be opened, which matters because "Reset to
 * defaults" lives inside it (ADR-0041, amended `D4.5`).
 */
const columnId = z.string().min(1).max(64);

/** A grid id, bounded for the same reason and to the same size. */
const gridId = z.string().min(1).max(64);

/**
 * One grid's arrangement, versioned in the payload as well as in the client's
 * storage key.
 *
 * **Moved here from `apps/admin/src/shared/grid/preferences.ts` by `D6.1`,
 * intact.** ADR-0041 put it beside the store — "nothing on the wire speaks
 * this today; the day a user-settings API does, moving it there is that
 * deliverable's work" — and this is that day. The `v: 1` literal and the three
 * bounds its `D4.5` amendment set are relocated without a change of meaning:
 * widths clamped {@link MIN_COLUMN_WIDTH}–{@link MAX_COLUMN_WIDTH}, ids
 * `min(1).max(64)`, arrays of at most {@link MAX_GRID_COLUMNS}.
 *
 * Each bound answers a way a well-formed entry could take a grid away from the
 * person using it: a stored `1` is a column an operator can see and cannot
 * grab, a stored `1e12` is one column that is the whole table, and an
 * unbounded `order` hangs the tab on the one surface that contains Reset.
 *
 * Validated twice on purpose — by the API on the way in, and by the client
 * store on the way out. The second is not redundancy: a version-2 entry
 * written by a newer client must reach an older client as a value that client
 * discards silently, because **corrupt preferences must never break a grid**.
 *
 * `z.object`, not `z.strictObject`, and that is the move being intact rather
 * than an oversight: the store has always stripped unknown keys instead of
 * discarding the whole entry over one, so a v1 entry a newer client wrote a
 * field into still restores the three slices this version knows.
 */
export const gridPreferencesSchema = z.object({
  v: z.literal(1),
  /** Column id → px. An absent id means "whatever the content needs". */
  sizing: z.record(
    columnId,
    z.number().int().min(MIN_COLUMN_WIDTH).max(MAX_COLUMN_WIDTH),
  ),
  /** Every movable column, in render order. */
  order: z.array(columnId).max(MAX_GRID_COLUMNS),
  /** The movable columns currently hidden. */
  hidden: z.array(columnId).max(MAX_GRID_COLUMNS),
});

/**
 * The patch both segments accept. Composed once and exported twice below, so
 * the pair is free to diverge without either export being renamed.
 *
 * An **empty body is accepted** and answers the resource unchanged. Unlike
 * `updateUserBody`, which refuses one because a patch naming no field is a
 * caller mistake, a settings patch is written by a debounced coalescing writer
 * (ADR-0045 §The server adapter): a flush with nothing to say is a race the
 * client should not have to detect, and refusing it would turn a harmless
 * no-op into a toast.
 */
const settingsPatch = z.strictObject({
  theme: z.enum(THEMES).optional(),
  locale: z.enum(LOCALES).optional(),
  /**
   * How tightly a grid packs its rows (`D11.6`, ADR-0053 §2).
   *
   * A third scalar beside the other two, replaced when present and untouched
   * when absent — the same merge rule, because it is the same kind of fact.
   * It rides the coalescing writer with the theme, so a toggle in the
   * page-header band and a column drag in the same second are one `PATCH`.
   */
  gridDensity: z.enum(GRID_DENSITIES).optional(),
  /**
   * Per key: an object replaces that grid's entry, `null` deletes it, and a
   * key absent from the body is untouched.
   *
   * The bound here is on the **body**; the one that matters is on the merged
   * row, and only the service can check it — forty existing keys plus twenty
   * new ones is a valid body and an invalid row (ADR-0045 §Endpoints).
   */
  grids: z
    .record(gridId, gridPreferencesSchema.nullable())
    .refine((grids) => Object.keys(grids).length <= MAX_SETTINGS_GRIDS, {
      error: `A settings patch carries at most ${String(MAX_SETTINGS_GRIDS)} grids`,
    })
    .optional(),
});

/** `PATCH /api/v1/admin/settings` — a staff member's own settings. */
export const updateStaffSettingsBody = settingsPatch;
export type UpdateStaffSettingsBody = z.infer<typeof updateStaffSettingsBody>;

/** `PATCH /api/v1/user/settings` — a customer's own settings. */
export const updateUserSettingsBody = settingsPatch;
export type UpdateUserSettingsBody = z.infer<typeof updateUserSettingsBody>;
