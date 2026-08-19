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
}

/** The `meta` a feature hands to {@link AppGrid}, reaching cell renderers. */
export interface GridMeta<TRow> {
  readonly rowActions?: readonly RowAction<TRow>[];
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
