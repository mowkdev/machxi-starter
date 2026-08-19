import type { CellRendererKey, FormatterKey } from "@/shared/resource/types";

import { RolesList, RowActions, StatusBadge } from "./cells";
import { date, dateTime } from "./formatters";
import type { CellRenderer, Formatter } from "./types";

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
 * - a typo'd key is a **compile error**, because `FormatterKey` and
 *   `CellRendererKey` are declared unions, not `string`;
 * - a key declared with **no** implementation is a compile error too, which is
 *   what `satisfies Record<…>` below is for;
 * - configs stay **mergeable and diffable**, which two closures could never be.
 *
 * Adding an entry is adding one named, unit-tested function. That is the cost,
 * and it is deliberately the only way to grow what a grid can render.
 */
export const gridRegistry = {
  formatters: { date, dateTime } satisfies Record<FormatterKey, Formatter>,
  cellRenderers: {
    rowActions: RowActions,
    statusBadge: StatusBadge,
    rolesList: RolesList,
  } satisfies Record<CellRendererKey, CellRenderer>,
} as const;

export type GridRegistry = typeof gridRegistry;
