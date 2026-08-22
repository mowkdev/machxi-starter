import type { Filter } from "@repo/contracts";

import { dateTimeFormat, type TranslateKey } from "@/shared/i18n";
import { resolveOptions } from "@/shared/resource/config";
import type {
  ColumnConfig,
  FilterControlConfig,
} from "@/shared/resource/types";

import { unescapeContains } from "./column-filters";
import { containsPattern, filterKey } from "./list-state";

/**
 * The applied-filters bar's contents, as data (ADR-0039, `D4.4`).
 *
 * **The load-bearing rule of the whole surface: the bar renders from the URL's
 * validated filters, never from the column configs.** It is the same lesson
 * `withFilters`' `owned` argument encodes, applied to display instead of to
 * update — a deep-linked or otherwise foreign filter on a field no column owns
 * *was actually sent to the server*, and a summary derived from configs would
 * omit it, leaving the grid silently narrower than its UI admits.
 *
 * So `columns` below contributes **labels only, never membership**. Every
 * filter gets a chip. Where a column owns the field the chip reads in the
 * operator's own words — the column's header, a human operator, an enum's
 * label; where none does, it falls back to a raw `field op value` rendering
 * that is ugly on purpose. It is showing the operator something no config
 * claimed to understand, and it must still be removable.
 *
 * Pure and unit-tested, beside `list-state` and `column-filters`, for the
 * reason those two are: this is where a mismatch between what was asked and
 * what is displayed would be invisible in a component test.
 */

export interface FilterChip {
  /** Field + op — stable identity for React and for tests. */
  readonly key: string;
  /** `Created from 12 Aug 2026` | `Deleted only` | the raw `x gte y`. */
  readonly label: string;
  /** Exactly what removing this chip removes. */
  readonly filter: Filter;
}

/**
 * The translator these functions take — the **app-wide** one, since `D7.4`.
 *
 * `D7.2` typed it `TFunction<"grid">`, which was right while every key here was
 * a `grid` one and is wrong now: a chip's words are half this module's phrasing
 * (`grid:chip.*`) and half the *column's* — its header, a `presence` filter's
 * label, an enum option's — and those are keys from a namespace this file must
 * never name. One translator over every namespace is what lets both be resolved
 * without a second parameter, at the price of spelling `grid:` on the keys this
 * module wrote itself. That price is the honest one: the prefix now says which
 * of the two kinds a key is.
 */
export type ChipTranslate = TranslateKey;

export const chipsForState = (
  filters: readonly Filter[],
  columns: readonly (readonly [string, ColumnConfig])[],
  t: ChipTranslate,
): readonly FilterChip[] => {
  /*
   * Field + op is the *filter's* identity and is what removal works on — but it
   * is not unique across a hand-written URL, which can carry
   * `filter[status][eq]` twice. React needs a key that is, so a repeat gets a
   * `#n` suffix; the first occurrence keeps the bare `field:op` the ADR names,
   * which is what every test and every ordinary URL sees. The two chips then
   * both remove the whole `field:op` entry, which is correct — `withoutFilter`
   * drops every match, so there is no half-removed state to reach.
   */
  const seen = new Map<string, number>();

  return filters.map((filter) => {
    const base = filterKey(filter);
    const repeat = seen.get(base) ?? 0;

    seen.set(base, repeat + 1);

    return {
      key: repeat === 0 ? base : `${base}#${repeat}`,
      label: labelFor(
        filter,
        columns.find(([name]) => name === filter.field)?.[1],
        t,
      ),
      filter,
    };
  });
};

/**
 * A chip's words, from the column's config where it has one.
 *
 * Falls through to {@link rawLabel} on every path the config cannot answer for
 * — no column, no filter declared, or a filter declared with a *different*
 * operator than the URL carries. The last case is the subtle one and it is
 * deliberate: a column declaring `like` tells us nothing about how to phrase an
 * `lte` somebody deep-linked onto the same field, so guessing would be the
 * config claiming knowledge it does not have.
 */
export const labelFor = (
  filter: Filter,
  column: ColumnConfig | undefined,
  t: ChipTranslate,
): string => {
  const config = column?.filter;

  if (column === undefined || config === undefined) return rawLabel(filter, t);

  const owned = ownedLabel(filter, t(column.header), config, t);

  return owned ?? rawLabel(filter, t);
};

const ownedLabel = (
  filter: Filter,
  header: string,
  config: FilterControlConfig,
  t: ChipTranslate,
): string | undefined => {
  switch (config.kind) {
    case "text": {
      if (filter.op !== config.op) return undefined;
      if (config.op !== "like")
        return t("grid:chip.isText", {
          column: header,
          value: asText(filter.value),
        });

      /*
       * "Contains" only where the pattern is one this app wrote.
       *
       * `unescapeContains` is a lossy inverse: it is exact for what
       * `containsPattern` produces and a guess for anything else. A deep link
       * carrying `like: "ada"` — no wrapping `%` — asks the server for an
       * *exact* match, and unwrapping it to `ada` would put "Email contains
       * “ada”" over an empty grid and let the operator conclude the substring
       * is missing rather than that they asked a different question.
       * `value: "%a%b%"` runs the other way: it renders as a literal `a%b`
       * while the wire pattern is two wildcards.
       *
       * So the term is round-tripped and only trusted if it reproduces the
       * pattern byte for byte. It usually does — every filter this UI writes
       * does — and where it does not, the chip falls through to the raw form,
       * which is the same answer this file gives every other filter it cannot
       * honestly phrase.
       */
      const pattern = asText(filter.value);
      const term = unescapeContains(pattern);

      return containsPattern(term) === pattern
        ? t("grid:chip.contains", { column: header, value: term })
        : undefined;
    }

    case "enum": {
      if (filter.op !== config.op) return undefined;

      const options = resolveOptions(config.options, t);
      const label = (value: unknown): string =>
        options.find((option) => option.value === value)?.label ??
        asText(value);

      return Array.isArray(filter.value)
        ? t("grid:chip.anyOf", {
            column: header,
            values: filter.value.map(label).join(", "),
          })
        : t("grid:chip.is", { column: header, value: label(filter.value) });
    }

    case "dateRange":
      /*
       * "from" and "to" rather than the operator's own name: `gte` is not a
       * word, and one chip per bound is what lets an operator loosen one end of
       * a range without re-composing the other.
       */
      return filter.op === config.from
        ? t("grid:chip.from", { column: header, day: boundDay(filter.value) })
        : filter.op === config.to
          ? t("grid:chip.to", { column: header, day: boundDay(filter.value) })
          : undefined;

    case "presence":
      /*
       * The config's own label, which is the one part of a filter config no
       * schema can check and the one the users grid had to get right: this
       * reads "Deleted only", not "Deleted is false" and not "Show deleted".
       *
       * Only when the value matches, though. `null: true` on a field whose
       * config writes `null: false` is the *opposite* scope, and lending it the
       * config's words would be the bar describing a request nobody made.
       */
      return filter.op === "null" && filter.value === config.value
        ? t(config.label)
        : undefined;
  }
};

/**
 * The honest rendering of a filter no config claimed.
 *
 * Deliberately unpolished — it is the visible admission that something is
 * narrowing this list that the screen has no vocabulary for. The alternative is
 * not a prettier chip, it is no chip, which is the failure ADR-0039 opens on.
 */
const rawLabel = (filter: Filter, t: ChipTranslate): string =>
  clamp(
    t("grid:chip.raw", {
      field: filter.field,
      op: filter.op,
      value: asText(filter.value),
    }),
  );

/**
 * The bound as the **day the operator picked**, which is a UTC day.
 *
 * Not the `date` cell formatter, and the difference is a real defect rather
 * than a nicety. `toListFilters` builds a range bound as UTC midnight (or UTC
 * end-of-day) of the day chosen in a `<input type="date">`, and the dialog
 * re-renders it with `toISOString().slice(0, 10)` — also UTC. Formatting the
 * same instant in the *operator's* timezone, which is right for a cell holding
 * a real event, moves an end-of-day bound forward a day east of UTC and a
 * start-of-day bound back a day west of it: the chip and the dialog would then
 * name different days for one filter.
 *
 * Cell values keep the local formatter. A bound is not an event; it is the day
 * that was typed.
 *
 * `D7.2` changed the **locale** and nothing else: the timezone reasoning above
 * is untouched, and `dateTimeFormat` resolves the tag per call so a chip
 * re-renders in the language its column header is in.
 */
const DAY_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeZone: "UTC",
};

const boundDay = (value: unknown): string => {
  const day = value instanceof Date ? value : new Date(String(value));

  return Number.isNaN(day.getTime())
    ? asText(value)
    : dateTimeFormat(DAY_OPTIONS).format(day);
};

/**
 * A ceiling on a label the URL wrote.
 *
 * `filterSchema` bounds neither a filter's `field` (`z.string()`) nor a scalar
 * `value` (`z.unknown()`) — which was harmless while nothing rendered a filter
 * no column owned, and stopped being harmless the moment this bar did. A link
 * carrying a 100 KB field name would otherwise wrap into a band that eats
 * ADR-0037's whole height budget and pushes the table and the pager off screen.
 * Nothing is hidden that was not already unreadable; the chip still removes the
 * whole filter.
 */
const MAX_LABEL = 80;

const clamp = (label: string): string =>
  label.length <= MAX_LABEL ? label : `${label.slice(0, MAX_LABEL)}…`;

const asText = (value: unknown): string =>
  Array.isArray(value)
    ? value.map(asText).join(", ")
    : value instanceof Date
      ? value.toISOString()
      : String(value);
