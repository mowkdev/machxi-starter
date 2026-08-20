import type { Filter } from "@repo/contracts";
import type { ColumnFiltersState } from "@tanstack/react-table";

import type {
  ColumnConfig,
  FilterControlConfig,
} from "@/shared/resource/types";

import { containsPattern } from "./list-state";

/**
 * The two-way translation between ADR-0014 filters and the engine's
 * `columnFilters` state (ADR-0035).
 *
 * Both directions are needed because the URL owns the state and the engine
 * holds the controls: the URL seeds `columnFilters` on every render, a control
 * changes it, and `onColumnFiltersChange` translates back to filters and
 * navigates. Keeping the pair here — pure, in one file — is what makes a
 * mismatch between the two directions a unit test rather than a bug an operator
 * finds by filtering and watching their filter disappear.
 */

/** What a column's filter control holds, discriminated the way its config is. */
export type ColumnFilterValue =
  | { readonly kind: "text"; readonly term: string }
  | { readonly kind: "enum"; readonly values: readonly string[] }
  | { readonly kind: "dateRange"; readonly from: string; readonly to: string }
  | { readonly kind: "presence"; readonly on: boolean };

/** Columns that declare a filter, paired with the config that describes it. */
export const filterableColumns = (
  columns: readonly (readonly [string, ColumnConfig])[],
): readonly (readonly [string, FilterControlConfig])[] =>
  columns.flatMap(([name, column]) =>
    column.filter === undefined ? [] : [[name, column.filter] as const],
  );

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** An ISO instant as the `yyyy-mm-dd` a `<input type="date">` holds. */
const toDateInput = (value: unknown): string => {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;

  return date === null || Number.isNaN(date.getTime())
    ? ""
    : date.toISOString().slice(0, 10);
};

/**
 * URL filters → the value one column's control renders from.
 *
 * Returns `undefined` when the field carries no filter, which is what keeps the
 * control's "empty" state and "the URL says nothing" the same state.
 */
export const toColumnFilterValue = (
  filters: readonly Filter[],
  field: string,
  config: FilterControlConfig,
): ColumnFilterValue | undefined => {
  const own = filters.filter((filter) => filter.field === field);

  if (own.length === 0) return undefined;

  switch (config.kind) {
    case "text": {
      const match = own.find((filter) => filter.op === config.op);
      if (match === undefined) return undefined;

      /*
       * The wire form of a "contains" filter is `%escaped%`; the control shows
       * what the operator typed. Unwrapping here rather than storing the raw
       * term separately keeps the URL the single source of truth — a pasted
       * link renders the same control state as the session that produced it.
       */
      return {
        kind: "text",
        term:
          config.op === "like"
            ? unescapeContains(asString(match.value))
            : asString(match.value),
      };
    }
    case "enum": {
      const match = own.find((filter) => filter.op === config.op);
      if (match === undefined) return undefined;

      return {
        kind: "enum",
        values: Array.isArray(match.value)
          ? match.value.map(asString)
          : [asString(match.value)],
      };
    }
    case "dateRange":
      return {
        kind: "dateRange",
        from: toDateInput(
          own.find((filter) => filter.op === config.from)?.value,
        ),
        to: toDateInput(own.find((filter) => filter.op === config.to)?.value),
      };
    case "presence": {
      const match = own.find((filter) => filter.op === "null");

      return match === undefined
        ? undefined
        : { kind: "presence", on: match.value === config.value };
    }
  }
};

/** The whole engine state, seeded from the URL. */
export const toColumnFiltersState = (
  filters: readonly Filter[],
  columns: readonly (readonly [string, FilterControlConfig])[],
): ColumnFiltersState =>
  columns.flatMap(([field, config]) => {
    const value = toColumnFilterValue(filters, field, config);

    return value === undefined ? [] : [{ id: field, value }];
  });

/**
 * One control's value → the ADR-0014 filters it means.
 *
 * A range produces two filters on one field and an empty control produces none,
 * which is why this returns an array rather than a filter: "no opinion" has to
 * be expressible, and an endpoint's default scope (ADR-0014's step-9
 * amendment) already means the right thing when the client says nothing.
 */
export const toListFilters = (
  field: string,
  config: FilterControlConfig,
  value: unknown,
): readonly Filter[] => {
  if (value === undefined || value === null) return [];

  switch (config.kind) {
    case "text": {
      const term = isKind(value, "text") ? value.term.trim() : "";
      if (term === "") return [];

      return config.op === "like"
        ? [{ field, op: "like", value: containsPattern(term) }]
        : [{ field, op: "eq", value: term }];
    }
    case "enum": {
      const values = isKind(value, "enum")
        ? value.values.filter((entry) => entry !== "")
        : [];
      if (values.length === 0) return [];

      return config.op === "in"
        ? [{ field, op: "in", value: values }]
        : [{ field, op: "eq", value: values[0] }];
    }
    case "dateRange": {
      if (!isKind(value, "dateRange")) return [];

      /*
       * A `<input type="date">` yields a bare `yyyy-mm-dd`, which `new Date()`
       * reads as **UTC midnight**. The contracts' date filters are
       * `z.coerce.date()` and ADR-0014's step-7 amendment makes the parsed value
       * the column's own type, so an ISO instant is what the wire wants — and
       * the upper bound is pushed to the end of the chosen day, because an
       * operator asking for "up to the 12th" means the 12th included, not
       * everything before it began.
       */
      return [
        ...(value.from === ""
          ? []
          : [
              {
                field,
                op: config.from,
                value: startOfDay(value.from),
              } as const,
            ]),
        ...(value.to === ""
          ? []
          : [{ field, op: config.to, value: endOfDay(value.to) } as const]),
      ];
    }
    case "presence":
      return isKind(value, "presence") && value.on
        ? [{ field, op: "null", value: config.value }]
        : [];
  }
};

/** The engine's whole filter state → the filters a navigation should carry. */
export const fromColumnFiltersState = (
  state: ColumnFiltersState,
  columns: readonly (readonly [string, FilterControlConfig])[],
): readonly Filter[] =>
  state.flatMap(({ id, value }) => {
    const config = columns.find(([field]) => field === id)?.[1];

    return config === undefined ? [] : toListFilters(id, config, value);
  });

const isKind = <TKind extends ColumnFilterValue["kind"]>(
  value: unknown,
  kind: TKind,
): value is Extract<ColumnFilterValue, { kind: TKind }> =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  (value as { kind: unknown }).kind === kind;

const startOfDay = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
const endOfDay = (day: string): Date => new Date(`${day}T23:59:59.999Z`);

/**
 * The inverse of {@link containsPattern}, for rendering a control from a URL.
 *
 * Exported since `D4.4`: the applied-filters bar has the same problem a control
 * does — the URL holds `%ada%` and the operator typed `ada` — and a chip
 * reading `Email contains "%ada%"` would be showing them the wire form of their
 * own words.
 */
export const unescapeContains = (pattern: string): string =>
  pattern
    .replace(/^%/, "")
    .replace(/%$/, "")
    .replace(/\\([\\%_])/g, "$1");
