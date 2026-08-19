import {
  LIST_QUERY_PARAMS,
  type Filter,
  type ListQuery,
  type SortSpec,
} from "@repo/contracts";

/**
 * The wire form of a list query (ADR-0014), produced in exactly one place.
 *
 * Two serializations are in play and only the *parsed* shape is shared. The
 * bracket syntax below — `filter[status][in]=a,b` — is what the API's Express
 * query parsing consumes; the app's own URL uses TanStack Router's
 * serialization of the same parsed object (ADR-0034 §List state lives in the
 * URL). The two need not match, and the contract between them is the
 * zod-validated `ListQuery`, not a string.
 *
 * Pinning it here is what stops a call site building a query string by hand,
 * which is the failure this exists to prevent: a hand-built `?sort=email:asc`
 * looks right and is rejected by `listQuerySchema` as a `VALIDATION_ERROR`.
 */

/** `-createdAt,email` — a leading `-` is descending (ADR-0014). */
const serializeSort = (sort: readonly SortSpec[]): string =>
  sort
    .map(({ field, direction }) => (direction === "desc" ? `-${field}` : field))
    .join(",");

/*
 * A `Date` is written as an ISO-8601 instant, which is the form ADR-0014's own
 * examples use (`filter[createdAt][gte]=2026-01-01`). This matters because the
 * parsed value really is a `Date` — `listStaffQuery` declares its date
 * fields `z.coerce.date()`, and ADR-0014's step-7 amendment made a filter's
 * value "the column's TypeScript type, not a string". `String(date)` would
 * write a locale- and timezone-dependent sentence
 * ("Thu Jan 01 2026 12:20:30 GMT+0200 (…)") that is 60 characters long and
 * loses milliseconds on the way back.
 */
const serializeScalar = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value);

const serializeFilterValue = (value: unknown): string =>
  Array.isArray(value)
    ? value.map(serializeScalar).join(",")
    : serializeScalar(value);

/**
 * `eq` is written bare — `filter[status]=active` — because that is the shorthand
 * ADR-0014 defines and the form a human reading the URL expects; every other
 * operator carries its own bracket.
 */
const appendFilter = (search: URLSearchParams, filter: Filter): void => {
  const key =
    filter.op === "eq"
      ? `${LIST_QUERY_PARAMS.filter}[${filter.field}]`
      : `${LIST_QUERY_PARAMS.filter}[${filter.field}][${filter.op}]`;

  search.append(key, serializeFilterValue(filter.value));
};

/**
 * The `paramsSerializer` the ADR-0033 client is configured with.
 *
 * Takes anything axios is given, but only knows how to write the ADR-0014
 * shape; a plain object of scalars passes through unchanged, which is what
 * every non-list request needs.
 */
export const serializeListParams = (
  params: Record<string, unknown>,
): string => {
  const search = new URLSearchParams();

  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;

    if (name === LIST_QUERY_PARAMS.sort && Array.isArray(value)) {
      const sort = serializeSort(value as readonly SortSpec[]);
      if (sort !== "") search.set(name, sort);
      continue;
    }

    if (name === LIST_QUERY_PARAMS.filter && Array.isArray(value)) {
      for (const filter of value as readonly Filter[]) {
        appendFilter(search, filter);
      }
      continue;
    }

    search.set(name, String(value));
  }

  return search.toString();
};

/**
 * A parsed `ListQuery` as the flat object axios serializes.
 *
 * `filters` is renamed to the `filter` the wire uses, and an empty `q` is
 * dropped rather than sent as `q=`, which the schema would reject as too short.
 */
export const toListParams = (query: ListQuery): Record<string, unknown> => ({
  [LIST_QUERY_PARAMS.offset]: query.offset,
  [LIST_QUERY_PARAMS.limit]: query.limit,
  [LIST_QUERY_PARAMS.sort]: query.sort,
  [LIST_QUERY_PARAMS.filter]: query.filters,
  ...(query.q === undefined || query.q === ""
    ? {}
    : { [LIST_QUERY_PARAMS.q]: query.q }),
});
