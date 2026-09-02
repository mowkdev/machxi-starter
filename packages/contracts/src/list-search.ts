import { LIST_QUERY_PARAMS } from "./list-query.js";

import type { SortDirection } from "./enums.js";
import type { SortSpec } from "./envelope.js";
import type { Filter, FilterOp } from "./list-query.js";

/**
 * The reader and writer of the list-query language (ADR-0014), used by every
 * transport that spells a list query as characters (ADR-0043).
 *
 * There is **one** serialization. The bracket syntax is not "the wire form"
 * beside a browser form — it is the form: the same string describes the same
 * page whether it follows `/api/v1/admin/staff` or `/staff` in the address
 * bar, which is what makes a grid's URL a valid API request and a support
 * question a one-keystroke check.
 *
 * It lives in contracts rather than in an app because it is the language's own
 * vocabulary — the parameter names, the `-` sort prefix, the operator
 * brackets — and because a second consumer is coming. Nothing here imports
 * zod: this is string work over `URLSearchParams`, which is why it fits inside
 * ADR-0023's one-dependency rule.
 *
 * The pair is an **involution**, and that is the property its suite asserts
 * rather than checking two functions that look right separately:
 *
 * ```ts
 * listQuerySearchSchema.parse(parseListSearch(stringifyListSearch(state))); // === state
 * ```
 *
 * The schema is inside the round trip on purpose. {@link stringifyListSearch}
 * writes nothing for an empty `sort` or `filters` — there is no `sort=` in
 * this language — so the values that come back are the schema's own defaults,
 * which is exactly how a router will use it.
 */

/**
 * What the writer accepts: a list query, with **every key optional**.
 *
 * Two widenings, each paid for by a caller that exists.
 *
 * `q` is `string | undefined` rather than `string`, because
 * `listQuerySearchSchema` infers `q?: string | undefined` from `.optional()`
 * while {@link ListQuery} declares `q?: string`, and under
 * `exactOptionalPropertyTypes` those are different types — an explicitly
 * `undefined` property is not an absent one. Widening here rather than
 * narrowing at each call site lets a parsed query and a route's validated
 * search be written by one function.
 *
 * The rest are optional because a router hands the writer **what is left after
 * its defaults have been stripped** (`stripSearchParams`): a grid showing page
 * one at the default size with one sort applied has exactly one key. The
 * writer therefore writes what it is given and nothing else, which is also
 * what a full {@link ListQuery} wants — every key is present, so every key is
 * written.
 *
 * Note that {@link isListSearchState} stays strict about all four. The type is
 * permissive because the writer can honestly do less; the predicate is strict
 * because its job is telling a list query apart from an unrelated bag of
 * parameters, and half a list query is not one.
 */
export interface ListSearchState {
  readonly offset?: number;
  readonly limit?: number;
  readonly sort?: readonly SortSpec[];
  readonly filters?: readonly Filter[];
  readonly q?: string | undefined;
  /**
   * `count=false` asks the endpoint to skip the aggregate (ADR-0060 §2).
   *
   * Written **only when it is `false`**, for the reason an empty `sort` writes
   * nothing: `count=true` is the default on both sides of the wire, so
   * spelling it would put a parameter in every grid's URL that says what its
   * absence already says.
   */
  readonly count?: boolean | undefined;
}

/** `-createdAt,email` — a leading `-` is descending (ADR-0014). */
const serializeSort = (sort: readonly SortSpec[]): string =>
  sort
    .map(({ field, direction }) => (direction === "desc" ? `-${field}` : field))
    .join(",");

/**
 * A `Date` is written as an ISO-8601 instant, which is the form ADR-0014's own
 * examples use (`filter[createdAt][gte]=2026-01-01`). The parsed value really
 * is a `Date` — a filterable date field is `z.coerce.date()`, and ADR-0014's
 * step-7 amendment made a filter's value "the column's TypeScript type, not a
 * string" — and `String(date)` would write a locale- and timezone-dependent
 * sentence 60 characters long that loses milliseconds on the way back.
 */
const serializeScalar = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value);

const serializeFilterValue = (value: unknown): string =>
  Array.isArray(value)
    ? value.map(serializeScalar).join(",")
    : serializeScalar(value);

/**
 * `eq` is written bare — `filter[status]=active` — because that is the
 * shorthand ADR-0014 defines and the form a human reading the URL expects;
 * every other operator carries its own bracket.
 */
const filterKey = (filter: Filter): string =>
  filter.op === "eq"
    ? `${LIST_QUERY_PARAMS.filter}[${filter.field}]`
    : `${LIST_QUERY_PARAMS.filter}[${filter.field}][${filter.op}]`;

/**
 * `URLSearchParams.toString()` with brackets written literally.
 *
 * Brackets are the one place where the encoder's default defeats the purpose:
 * `filter%5Bstatus%5D=active` is not a readable URL, and browsers display,
 * accept and preserve raw brackets in a query string. Percent-encoding them
 * was never a decision — it is what `toString()` happens to do — and the two
 * strings are the same query once decoded, which `apps/api`'s own suite proves
 * against a real endpoint rather than leaving to reasoning.
 *
 * Only the brackets are touched. A `like` pattern's `%` stays `%25`, which is
 * what makes the client-side escaping of an operator's literal `100%`
 * (ADR-0039) survive the trip.
 */
const canonical = (search: URLSearchParams): string =>
  search.toString().replaceAll("%5B", "[").replaceAll("%5D", "]");

/**
 * A list query as the one canonical query string.
 *
 * **Present keys are written; absent keys are not**, which is what lets one
 * writer serve a full parsed query and a router's post-`stripSearchParams`
 * remainder alike. Two absences are stronger than that and are decisions:
 * an empty `sort` or `filters` writes nothing, because this language has no
 * way to say "sort by nothing", and an empty `q` writes nothing because `q=`
 * is a `VALIDATION_ERROR` and not a search for nothing.
 */
export const stringifyListSearch = (state: ListSearchState): string => {
  const search = new URLSearchParams();

  if (state.offset !== undefined)
    search.set(LIST_QUERY_PARAMS.offset, String(state.offset));
  if (state.limit !== undefined)
    search.set(LIST_QUERY_PARAMS.limit, String(state.limit));

  const sort = serializeSort(state.sort ?? []);
  if (sort !== "") search.set(LIST_QUERY_PARAMS.sort, sort);

  for (const filter of state.filters ?? []) {
    search.append(filterKey(filter), serializeFilterValue(filter.value));
  }

  if (state.q !== undefined && state.q !== "")
    search.set(LIST_QUERY_PARAMS.q, state.q);

  if (state.count === false) search.set(LIST_QUERY_PARAMS.count, "false");

  return canonical(search);
};

/**
 * `filter[status]` or `filter[status][in]`.
 *
 * One spelling, because `URLSearchParams` has already decoded the key: a
 * hand-typed `filter%5Bstatus%5D` arrives here as `filter[status]`, so the
 * reader accepts both spellings without knowing there are two.
 */
const FILTER_KEY = /^filter\[([^\]]+)\](?:\[([^\]]+)\])?$/;

/**
 * A numeric parameter, left alone when it is not a number.
 *
 * `offset=x` becomes the string `"x"` rather than `NaN`, so the schema reports
 * a `VALIDATION_ERROR` naming the parameter instead of a router silently
 * paging to `NaN`. Recovering the *shape* is this function's job; deciding
 * whether the shape is legal is `listQuerySearchSchema`'s.
 */
const toNumber = (raw: string): number | string => {
  const value = Number(raw);

  return raw.trim() !== "" && Number.isFinite(value) ? value : raw;
};

const toSortSpecs = (raw: string): SortSpec[] =>
  raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token !== "")
    .map((token) => {
      const descending = token.startsWith("-");
      const direction: SortDirection = descending ? "desc" : "asc";

      return { field: descending ? token.slice(1) : token, direction };
    });

/**
 * The value shapes a string cannot carry, recovered from the operator rather
 * than guessed: `in` is a comma list, `null` is a boolean, everything else is
 * the scalar the field's own schema will coerce.
 *
 * A `null` value that is neither `"true"` nor `"false"` is passed through as
 * the string it was, for the same reason {@link toNumber} passes `"x"`
 * through: a wrong value is the schema's to reject and name.
 */
const toFilterValue = (op: FilterOp, raw: string): unknown => {
  if (op === "in") return raw.split(",").map((entry) => entry.trim());
  if (op === "null" && (raw === "true" || raw === "false"))
    return raw === "true";

  return raw;
};

/**
 * A canonical query string back into the parsed shape.
 *
 * Returns `unknown`, deliberately: this recovers shape from characters, and
 * `listQuerySearchSchema` decides whether that shape is valid — exactly as it
 * does for any other input. A codec that validated would be a second place
 * where "what a list query may contain" is defined, which is the duplication
 * ADR-0043 exists to remove.
 *
 * Only the names {@link LIST_QUERY_PARAMS} defines are read, and only those
 * actually present appear in the result. Absent keys are absent, so the
 * schema's own defaults fill them; a caller that also holds non-list params
 * (a router, whose search is one object across every route) merges them
 * around this.
 */
export const parseListSearch = (
  search: string | URLSearchParams,
): Record<string, unknown> => {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const state: Record<string, unknown> = {};
  const filters: Filter[] = [];

  for (const [key, raw] of params) {
    if (key === LIST_QUERY_PARAMS.offset || key === LIST_QUERY_PARAMS.limit) {
      state[key] = toNumber(raw);
      continue;
    }

    if (key === LIST_QUERY_PARAMS.sort) {
      state[key] = toSortSpecs(raw);
      continue;
    }

    if (key === LIST_QUERY_PARAMS.q) {
      state[key] = raw;
      continue;
    }

    if (key === LIST_QUERY_PARAMS.count) {
      // `count=maybe` is passed through as the string it was, for the reason
      // `toNumber` passes `"x"` through: a wrong value is the schema's to
      // reject and name, not the codec's to guess at.
      state[key] = raw === "true" || raw === "false" ? raw === "true" : raw;
      continue;
    }

    const match = FILTER_KEY.exec(key);

    if (match) {
      const [, field, op = "eq"] = match;

      filters.push({
        field: field as string,
        op: op as FilterOp,
        value: toFilterValue(op as FilterOp, raw),
      } as Filter);
    }
  }

  if (filters.length > 0) state.filters = filters;

  return state;
};

/**
 * Whether a bag of parameters is a list query, for a client that serializes
 * both kinds through one function.
 *
 * A structural test rather than a flag, because the caller is an HTTP client's
 * `paramsSerializer` and what reaches it is whatever a call site passed. The
 * four required fields are what {@link stringifyListSearch} reads; anything
 * else is an ordinary parameter object and is written the ordinary way.
 */
export const isListSearchState = (
  params: object,
): params is ListSearchState => {
  const bag = params as Record<string, unknown>;

  return (
    typeof bag[LIST_QUERY_PARAMS.offset] === "number" &&
    typeof bag[LIST_QUERY_PARAMS.limit] === "number" &&
    Array.isArray(bag[LIST_QUERY_PARAMS.sort]) &&
    Array.isArray(bag["filters"])
  );
};
