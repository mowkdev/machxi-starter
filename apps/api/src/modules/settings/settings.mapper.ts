import {
  DEFAULT_GRID_DENSITY,
  DEFAULT_LOCALE,
  DEFAULT_THEME,
  type StaffSettingsResource,
  type UserSettingsResource,
} from "@repo/contracts";

import type { SettingsRecord } from "./settings.repository.js";

/**
 * Storage row → wire resource (ADR-0012, ADR-0045).
 *
 * The two resource types are the same shape today and the mapper produces
 * both; the pair is the split point, so when one population's settings grow a
 * field this function is what splits with them.
 *
 * The resource carries **no `id` and no timestamps**: its subject is the
 * principal, which the caller already is, and `updatedAt` would answer a
 * question nothing asks. ADR-0012 requires ISO timestamps where they appear,
 * not that they appear.
 */
type SettingsResource = StaffSettingsResource & UserSettingsResource;

/**
 * What a principal with no row has.
 *
 * The same values the column defaults hold, because both come from the one
 * declaration in `@repo/contracts` (ADR-0023) — so `GET` before any write and
 * `GET` after a write that named neither field cannot disagree.
 */
export const settingsDefaults: SettingsResource = {
  theme: DEFAULT_THEME,
  locale: DEFAULT_LOCALE,
  gridDensity: DEFAULT_GRID_DENSITY,
  grids: {},
};

/**
 * `undefined` — no row — maps to the defaults rather than to a `404`: a
 * principal always has settings, and the client is never asked to tell "you
 * have none" from "yours are the defaults" (ADR-0045).
 */
export const toSettingsResource = (
  record: SettingsRecord | undefined,
): SettingsResource => record ?? settingsDefaults;
