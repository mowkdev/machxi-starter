import {
  isListSearchState,
  stringifyListSearch,
  type ListQuery,
  type ListQuerySearch,
} from "@repo/contracts";

/**
 * The axios adapter for the one list-query serialization (ADR-0043).
 *
 * The syntax is not here and must never come back here. `@repo/contracts` owns
 * the language — the parameter names, the `-` sort prefix, the operator
 * brackets, the ISO instant a `Date` is written as — and this file only decides
 * which of the two things a `paramsSerializer` can be handed is in front of it.
 *
 * That the browser's URL and this request now spell a list query identically is
 * the point of the decision, not a coincidence: a grid's query string pasted
 * onto `/api/v1/admin/staff` is the same request the grid made.
 */

/**
 * The `paramsSerializer` the ADR-0033 client is configured with.
 *
 * A list query goes through the canonical writer; anything else is an ordinary
 * parameter bag and is written the ordinary way. The branch is structural
 * rather than a flag because what reaches a `paramsSerializer` is whatever a
 * call site passed, and axios has no way to label it.
 */
export const serializeListParams = (params: object): string => {
  if (isListSearchState(params)) return stringifyListSearch(params);

  const search = new URLSearchParams();

  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;

    search.set(name, String(value));
  }

  return search.toString();
};

/**
 * A route's validated search params as the list query a hook takes.
 *
 * The two types describe the same thing and differ in one place:
 * `listQuerySearchSchema` declares `q` with `.optional()`, which infers
 * `q?: string | undefined`, while `ListQuery` declares `q?: string`. Under
 * `exactOptionalPropertyTypes` those are not the same type — an explicitly
 * `undefined` property is not an absent one — so the hand-off needs a place to
 * drop the key rather than pass `undefined` through it.
 *
 * That place is here rather than a spread at every page, because the same
 * conversion is the first line of every list screen and a `q` accidentally
 * serialized as `q=` is a `VALIDATION_ERROR` from the endpoint's own schema.
 */
export const toListQuery = (search: ListQuerySearch): ListQuery => {
  const { q, ...rest } = search;

  return q === undefined ? rest : { ...rest, q };
};
