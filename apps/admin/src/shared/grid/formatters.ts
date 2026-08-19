import type { Formatter } from "./types";

/**
 * The named value formatters (ADR-0035 §The grid registry).
 *
 * Each one is a function from a cell's raw value to a string, small enough to
 * unit-test on its own, and named so a config can reach it by key instead of
 * carrying a closure. Adding one is adding one tested entry to the registry;
 * that finite, greppable vocabulary is the return on the indirection.
 */

/**
 * The dash a missing value renders as.
 *
 * An en dash rather than an empty cell: a blank looks like a rendering failure,
 * and "this account has never signed in" is information worth showing as
 * something.
 */
export const EMPTY_CELL = "—";

/**
 * Rendered in the operator's own locale and timezone.
 *
 * The wire is always UTC ISO-8601 (ADR-0012), and a staff member reading a
 * table wants the local reading of it. `undefined` as the locale is the browser
 * default, which is the operator's, not the bundle's.
 */
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/**
 * Parses what the envelope actually carries.
 *
 * `IsoDateTime` is a string on the wire, but a config may point a date
 * formatter at a value the client already parsed, so both are accepted. An
 * unparseable value returns `null` and renders as {@link EMPTY_CELL} rather
 * than as `Invalid Date`, which is what `toLocaleString` would put on screen.
 */
const toDate = (value: unknown): Date | null => {
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string" && typeof value !== "number") return null;

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const format =
  (formatter: Intl.DateTimeFormat): Formatter =>
  (value) => {
    const date = toDate(value);

    return date === null ? EMPTY_CELL : formatter.format(date);
  };

/** `12 Aug 2026` */
export const date: Formatter = format(dateFormat);

/** `12 Aug 2026, 14:05` */
export const dateTime: Formatter = format(dateTimeFormat);

/** The fallback for a column that declares no formatter and no renderer. */
export const text: Formatter = (value) =>
  value === null || value === undefined || value === ""
    ? EMPTY_CELL
    : String(value);
