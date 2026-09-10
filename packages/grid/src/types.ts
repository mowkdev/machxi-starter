import type { ReactNode } from "react";

/**
 * What a grid's *behaviour* is passed as, separately from its config
 * (ADR-0035 §Row actions).
 *
 * Entities supply config; features supply handlers. Keeping the two apart is
 * what lets the config stay serializable — a callback in `staffResourceConfig`
 * would kill diffing and merging for the sake of one edit button.
 */

/** One entry of a row's action menu. */
export interface RowAction<TRow> {
  /** Stable key for React, and what a test can find the item by. */
  readonly key: string;
  readonly label: string;
  readonly onSelect: (row: TRow) => void;
  /** Renders in the destructive style and last — delete, revoke. */
  readonly destructive?: boolean;
  /** A row the action cannot apply to (the caller's own account, say). */
  readonly isDisabled?: (row: TRow) => boolean;
  /**
   * A row the action does not **exist** for, as opposed to one it is refused
   * on (`D18.11`).
   *
   * The distinction is worth the second predicate. `isDisabled` says "this
   * control applies here and you may not use it", which is the honest answer
   * when a rule depends on the actor or on state the client does not hold.
   * This says "there is no such operation on this row" — an invitation to
   * re-send to somebody who has already accepted one, say — and a menu that
   * greyed those out would carry one dead entry per row for the sake of a
   * case that is the exception rather than the rule.
   *
   * It reads the **row**, so what it may decide is what the row says. A
   * predicate here that guessed at the actor's standing, or at a count only
   * the server holds, would be the client-side authorization ADR-0042 keeps
   * out of this file — that belongs to `can()`, above the grid.
   */
  readonly isHidden?: (row: TRow) => boolean;
}

/** The `meta` a feature hands to {@link AppGrid}, reaching cell renderers. */
export interface GridMeta<TRow> {
  readonly rowActions?: readonly RowAction<TRow>[];
}

/**
 * What the toolbar knows about the selection (ADR-0038).
 *
 * Handed to `renderToolbar` for the screen whose toolbar is genuinely bespoke,
 * and to `onBulkDelete` so the action that consumes a selection can also end it
 * — see the amendment note on `AppGridProps.onBulkDelete`.
 *
 * `selectedIds` are resource ids, not row indices: `getRowId` is always set, so
 * a selection made on page one is still these ids on page three.
 */
export interface GridToolbarContext {
  readonly selectedIds: readonly string[];
  readonly clearSelection: () => void;
}

/**
 * What every registered cell renderer is called with.
 *
 * The row is `unknown` here and typed at the call site: `shared/grid` may hold
 * no domain knowledge (ADR-0032), so the machinery erases the row type exactly
 * once, on the way into the registry, rather than making every feature cast on
 * the way in. See `columns.tsx` for the single cast that does it.
 */
export interface CellRendererProps {
  readonly value: unknown;
  readonly row: unknown;
  /** The row's own id, for renderers that need to name themselves per row. */
  readonly rowId: string;
  readonly meta: GridMeta<unknown>;
}

export type CellRenderer = (props: CellRendererProps) => ReactNode;

/** A value rendered as text. `null` and `undefined` are the caller's problem. */
export type Formatter = (value: unknown) => string;
