import type { Filter, ListQuerySearch, SortSpec } from "@repo/contracts";
import type { SortingState } from "@tanstack/react-table";

/**
 * The translation layer between the URL's list state (ADR-0034) and the
 * engine's own state shape (ADR-0035).
 *
 * Pure functions over plain data, deliberately: this is the seam where a bug
 * would be invisible in a component test and obvious in a unit one, so it is
 * kept out of the component entirely.
 *
 * Every mutator returns a **new** `ListQuerySearch` rather than editing one,
 * because the caller navigates with the result and TanStack Router compares
 * search objects to decide whether anything changed.
 */

/** `[{ field: "email", direction: "desc" }]` → `[{ id: "email", desc: true }]`. */
export const toSortingState = (sort: readonly SortSpec[]): SortingState =>
  sort.map(({ field, direction }) => ({
    id: field,
    desc: direction === "desc",
  }));

export const fromSortingState = (sorting: SortingState): SortSpec[] =>
  sorting.map(({ id, desc }) => ({
    field: id,
    direction: desc ? "desc" : "asc",
  }));

/**
 * Any change to *what* is listed goes back to the first page.
 *
 * Sorting, filtering or searching from page 4 and staying on page 4 is how an
 * operator ends up looking at an empty grid and concluding there are no
 * results — the stranded-offset failure, arrived at deliberately instead of by
 * a deletion. Only an explicit page change keeps its offset.
 */
const atFirstPage = (state: ListQuerySearch): ListQuerySearch => ({
  ...state,
  offset: 0,
});

export const withSort = (
  state: ListQuerySearch,
  sort: readonly SortSpec[],
): ListQuerySearch => atFirstPage({ ...state, sort: [...sort] });

/**
 * Replaces the filters the grid's own controls own, and **only** those.
 *
 * Whole-set for the owned fields, because that is the shape the engine reports:
 * `onColumnFiltersChange` hands back every column's filter state at once, and
 * translating it back into ADR-0014 filters is one function
 * (`fromColumnFiltersState`), not a diff. A range control writing two filters
 * on one field falls out of that for free.
 *
 * `owned` is what stops it being lossy, and the failure it prevents is not
 * hypothetical: a URL may legitimately carry a filter on a field no *column*
 * declares a control for — a deep link, or a future toolbar control. Replacing
 * `state.filters` wholesale would erase it the moment the operator touched any
 * column filter, silently widening what they are looking at. A filter the grid
 * did not put there is not the grid's to remove.
 */
export const withFilters = (
  state: ListQuerySearch,
  owned: readonly string[],
  filters: readonly Filter[],
): ListQuerySearch =>
  atFirstPage({
    ...state,
    filters: [
      ...state.filters.filter((filter) => !owned.includes(filter.field)),
      ...filters,
    ],
  });

/** The free-text term. An empty term is removed, never sent as `q=`. */
export const withSearch = (
  state: ListQuerySearch,
  term: string,
): ListQuerySearch => {
  const { q: _q, ...rest } = state;

  return atFirstPage(term === "" ? rest : { ...rest, q: term });
};

export const withOffset = (
  state: ListQuerySearch,
  offset: number,
): ListQuerySearch => ({ ...state, offset: Math.max(0, offset) });

/** A page-size change keeps the operator near where they were, not at page 1. */
export const withLimit = (
  state: ListQuerySearch,
  limit: number,
): ListQuerySearch => ({
  ...state,
  limit,
  offset: Math.floor(state.offset / limit) * limit,
});

/**
 * The offset of the last page that can hold a row.
 *
 * The stranded-offset repair (ADR-0035): deletions shrink the dataset below the
 * page the operator is on, the API answers an empty `items` with the true
 * `total`, and the grid navigates here instead of leaving them on a blank page
 * wondering whether everything is gone.
 */
export const lastPageOffset = (total: number, limit: number): number =>
  total <= 0 ? 0 : Math.floor((total - 1) / limit) * limit;

/** Whether the current page is past the end of a dataset the API has counted. */
export const isStranded = (
  page: { readonly items: readonly unknown[]; readonly total: number | null },
  offset: number,
): boolean =>
  page.items.length === 0 &&
  page.total !== null &&
  page.total > 0 &&
  offset >= page.total;

/**
 * Escapes a term so `ILIKE` matches it literally, then wraps it for containment.
 *
 * ADR-0014 deliberately does **not** escape `like` filters, because a client
 * writing `filter[email][like]=%40acme.com` wrote that pattern on purpose. A UI
 * writing the pattern *on the operator's behalf* is the opposite case: someone
 * typing `100%` means the four characters, and passing that through unescaped
 * turns their filter into "match everything". So the escaping ADR-0014 puts on
 * `q` server-side is what this does client-side, for the same reason.
 *
 * `\` is Postgres' default escape character and is escaped first, which the
 * single character class does in one pass.
 */
export const containsPattern = (term: string): string =>
  `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
