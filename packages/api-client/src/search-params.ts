import {
  LIST_QUERY_PARAMS,
  parseListSearch,
  stringifyListSearch,
  type ListSearchState,
} from "@repo/contracts";
import {
  defaultParseSearch,
  defaultStringifySearch,
} from "@tanstack/react-router";

/**
 * The address bar's half of the one list-query serialization (ADR-0043).
 *
 * Beside `list-params.ts`, which is the same language for axios, and for the
 * same reason: there is one syntax, in `@repo/contracts`, and each transport
 * gets an adapter rather than a dialect. What this pair buys is that a grid's
 * query string **is** an API query string — `/staff?sort=-email&filter[status]=active`
 * pasted onto `/api/v1/admin/staff` returns the page the grid is showing.
 *
 * ## Why the router and not the route
 *
 * `validateSearch` must be an **involution**: TanStack Router round-trips its
 * own validated output back into the URL on every navigation, so whatever a
 * route validates to is what gets serialized next. That is the `D3.5` finding
 * (`listStaffQuery.safeParse(listStaffQuery.parse({}))` fails, which is why
 * `listQuerySearchSchema` exists), and it means the routes must keep holding
 * the rich parsed object — `sort: SortSpec[]`, `filters: Filter[]` — while the
 * change lives one layer down, in the functions that turn that object into
 * characters. Nothing above this file knows the URL changed shape.
 *
 * ## Scope
 *
 * These adapters touch **only the names {@link LIST_QUERY_PARAMS} defines**
 * and hand everything else to the router's own implementation, so
 * `/login?redirect=%2Fstaff` is serialized exactly as it was before this
 * existed, and a future non-list search param needs no permission from this
 * decision. A global codec is a global blast radius; the delegation is what
 * bounds it.
 */

/** The list language's *object* keys — what a route's validated search holds. */
const LIST_STATE_KEYS: ReadonlySet<string> = new Set([
  LIST_QUERY_PARAMS.offset,
  LIST_QUERY_PARAMS.limit,
  LIST_QUERY_PARAMS.sort,
  LIST_QUERY_PARAMS.q,
  "filters",
]);

/**
 * The list language's *string* keys — what a query string carries.
 *
 * Not the same set, and the difference is the one asymmetry in this language:
 * the parsed field is `filters` (an array) while the parameter is `filter`
 * (one per operator, `filter[status][in]`). A reader that looked for `filters`
 * in a URL would find nothing and silently drop every filter.
 */
const isListParam = (key: string): boolean =>
  LIST_STATE_KEYS.has(key) ||
  key.startsWith(`${LIST_QUERY_PARAMS.filter}[`) ||
  key === LIST_QUERY_PARAMS.filter;

/**
 * A query string into the search object the routes validate.
 *
 * The router's own parser runs first and its list-language keys are then
 * discarded rather than merged: `defaultParseSearch` JSON-parses values, so it
 * reads `sort=-email` as the string `"-email"` and `filter[status]` as a key
 * of its own — both true and neither useful. `parseListSearch` supplies those
 * keys in the shape the schema expects, and anything it does not claim (a
 * `redirect`, a future param) survives untouched.
 */
export const parseAdminSearch = (
  searchStr: string,
): Record<string, unknown> => {
  const parsed = defaultParseSearch(searchStr) as Record<string, unknown>;
  const rest: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (!isListParam(key)) rest[key] = value;
  }

  return { ...rest, ...parseListSearch(searchStr) };
};

/**
 * Whether a value is the shape the list language expects under that key.
 *
 * A key that fails its own guard is **handed to the default serializer rather
 * than dropped**. Nothing should ever reach here malformed — the router
 * serializes what `validateSearch` validated — and "should never" is exactly
 * the kind of assumption that loses an operator's filter silently. Writing it
 * the old way is visible and recoverable; omitting it is neither.
 */
const isListValue = (key: string, value: unknown): boolean => {
  if (key === LIST_QUERY_PARAMS.offset || key === LIST_QUERY_PARAMS.limit)
    return typeof value === "number";
  if (key === LIST_QUERY_PARAMS.sort || key === "filters")
    return Array.isArray(value);

  return typeof value === "string";
};

/**
 * The search object back into a query string, with the leading `?` the router
 * expects and an empty string when there is nothing to say.
 *
 * The list keys go through the canonical writer — which writes only the keys
 * it is given, so a route's `stripSearchParams` middleware still decides what
 * is worth spelling — and the rest through the router's own serializer, whose
 * output has its `?` trimmed before the two are joined.
 */
export const stringifyAdminSearch = (
  search: Record<string, unknown>,
): string => {
  const rest: Record<string, unknown> = {};
  const state: ListSearchState = {};

  for (const [key, value] of Object.entries(search)) {
    if (!LIST_STATE_KEYS.has(key) || !isListValue(key, value)) {
      rest[key] = value;
      continue;
    }

    Object.assign(state, { [key]: value });
  }

  const list = stringifyListSearch(state);
  const others = defaultStringifySearch(rest).replace(/^\?/, "");
  const query = [list, others].filter((part) => part !== "").join("&");

  return query === "" ? "" : `?${query}`;
};
