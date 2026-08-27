import { dateTimeFormat } from "@repo/i18n";

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
 * Rendered in **the app's** locale and the operator's timezone (ADR-0046 §5,
 * `D7.2`).
 *
 * The wire is always UTC ISO-8601 (ADR-0012), and a staff member reading a
 * table wants the local reading of it. The timezone is still implicit — that is
 * the browser's and is correct, because an instant on screen should read in the
 * time the operator is living in. The **locale** was implicit too, and that was
 * wrong: `undefined` means the browser's language, not the app's, so a Latvian
 * operator on an English OS would have read `lv` headers over `en-GB` dates.
 *
 * The options are module constants because {@link dateTimeFormat} caches on
 * them: an object built inline would key the cache on a fresh string every
 * cell.
 */
const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
};

const DATE_OPTIONS: Intl.DateTimeFormatOptions = { dateStyle: "medium" };

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

/*
 * The formatter is resolved **per call**, not captured once.
 *
 * That is what makes a locale switch move the dates without a remount: the
 * registry's entries have to stay `(value) => string` (ADR-0035), so they
 * cannot take a locale, and a formatter built at module load would hold
 * whichever locale the app started in for the rest of the session.
 * `dateTimeFormat` caches on the active tag, so this costs a `Map` lookup per
 * cell rather than a constructor.
 */
const format =
  (options: Intl.DateTimeFormatOptions): Formatter =>
  (value) => {
    const date = toDate(value);

    return date === null ? EMPTY_CELL : dateTimeFormat(options).format(date);
  };

/** `12 Aug 2026` */
export const date: Formatter = format(DATE_OPTIONS);

/** `12 Aug 2026, 14:05` */
export const dateTime: Formatter = format(DATE_TIME_OPTIONS);

/** The fallback for a column that declares no formatter and no renderer. */
export const text: Formatter = (value) =>
  value === null || value === undefined || value === ""
    ? EMPTY_CELL
    : String(value);
