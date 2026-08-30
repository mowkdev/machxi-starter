import { DEFAULT_GRID_DENSITY, type GridDensity } from "@repo/contracts";
import { createContext, useContext } from "react";

/**
 * How tightly the table packs its rows (`D11.6`, ADR-0054 §6).
 *
 * **A mode, not a scale**, and it moves exactly three values: the body row's
 * height, the horizontal cell padding, and the in-row badge. Everything else
 * about the grid — the 34px header band, the 48px toolbar and pager bands, the
 * 40px Filtered-by band — is chrome *around* the table at its own fixed
 * height, and a row-density mode that resized those would be a mode that moved
 * the height budget it lives inside (ADR-0037 as carried by 0054).
 *
 * The classes live here rather than beside each element for the reason §2 of
 * the record gives about colour: a value spelled in a component is a value
 * that can drift from its pair. Two tables, three rows, one place to read the
 * mode off.
 */

/** The body row's height. The header keeps its own 34 in both modes. */
export const DENSITY_ROW_HEIGHT: Record<GridDensity, string> = {
  comfortable: "h-[44px]",
  compact: "h-[34px]",
};

/**
 * The horizontal cell padding — 10 / 8 — and it is the **pair's**, not the
 * body's.
 *
 * A `td` at 8 under a `th` at 10 puts every label two pixels off its own
 * column, so the header takes this too even though its height is fixed.
 * Padding is a column value; height is a row value.
 */
export const DENSITY_CELL_X: Record<GridDensity, string> = {
  comfortable: "px-2.5",
  compact: "px-2",
};

/**
 * The in-row badge — the role badge, which since `D11.2` is the only badge
 * left inside a row (the status is a dot).
 *
 * 22 keeps a badge's 6px of breathing room inside a 34px row, which is what 26
 * does inside 44. The chips in the Filtered-by band are not this: they are
 * chrome outside the table and hold their own 26.
 */
export const DENSITY_BADGE: Record<GridDensity, string> = {
  comfortable: "h-[26px] px-2",
  compact: "h-[22px] px-1.5",
};

/**
 * The mode the cells below `AppGrid` render at.
 *
 * **Internal to this package and deliberately not exported from `index.ts`.**
 * `AppGrid` takes `density` as a prop — the `striped` precedent — and provides
 * it here only because the cell renderers are reached through the registry
 * (ADR-0035) and so cannot be handed one: a config carries the *key*
 * `"rolesList"`, and the component it names is instantiated by the table.
 * Everything a caller can pass is still a prop.
 *
 * The default is `@repo/contracts`' own, so a badge or a table rendered with
 * no provider above it is comfortable for one declared reason rather than two
 * agreeing ones. That case is not hypothetical: `RolesList` is exported and
 * the admin's `pages/profile` renders it outside any table, where 26px is the
 * right answer and §6's mode has nothing to say.
 */
const GridDensityContext = createContext<GridDensity>(DEFAULT_GRID_DENSITY);

export const GridDensityProvider = GridDensityContext.Provider;

export const useRowDensity = (): GridDensity => useContext(GridDensityContext);
