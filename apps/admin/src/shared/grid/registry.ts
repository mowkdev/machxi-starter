import { RolesList, RowActions, StatusBadge } from "./cells";
import { date, dateTime } from "./formatters";

/**
 * The grid's whole UI vocabulary, in one readable object (ADR-0035).
 *
 * A **named registry** is what makes "configs are data" affordable: a config
 * carries the *key* `"dateTime"`, the implementation lives here, and the two
 * are joined at render. The three properties that buys, in the order they
 * matter:
 *
 * - the vocabulary is **finite and reviewable** — a reader learns everything a
 *   grid in this app can do by reading this file;
 * - a typo'd key is a **compile error**, because {@link FormatterKey} and
 *   {@link CellRendererKey} are `keyof` these maps, not `string`;
 * - configs stay **mergeable and diffable**, which two closures could never be.
 *
 * Adding an entry is adding one named, unit-tested function. That is the cost,
 * and it is deliberately the only way to grow what a grid can render.
 */
export const gridRegistry = {
  formatters: { date, dateTime },
  cellRenderers: {
    rowActions: RowActions,
    statusBadge: StatusBadge,
    rolesList: RolesList,
  },
} as const;

export type GridRegistry = typeof gridRegistry;
export type FormatterKey = keyof GridRegistry["formatters"];
export type CellRendererKey = keyof GridRegistry["cellRenderers"];
