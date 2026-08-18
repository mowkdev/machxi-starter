import {
  filtersToRecord,
  type Filter,
  type ListQuery,
  type Page,
} from "@repo/contracts";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  type SQL,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * The Drizzle half of the list-query machinery (ADR-0014).
 *
 * The parser — `listQuerySchema` and everything it produces — lives in
 * `@repo/contracts`, because an admin table needs the same types to build its
 * request and read the response. It is re-exported here so module code has a
 * single import, and this file adds what must not go into a browser-safe
 * package: the translation from a parsed {@link ListQuery} to SQL.
 */

export {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  filtersToRecord,
  listQuerySchema,
  type Filter,
  type FilterOp,
  type FilterSpec,
  type ListQuery,
  type ListQueryOptions,
  type Page,
} from "@repo/contracts";

/**
 * Maps an API field name to its column. Declared per module beside the
 * `sortable` / `filterable` allow-lists it must cover — a field the schema
 * admits but this map omits is a wiring bug, and is reported as one.
 *
 * The other half of that pairing is the filter's `value` schema: Drizzle binds
 * a parameter through the column's own driver mapper, so a `timestamp` column
 * needs `value: z.coerce.date()` and not the default string. A mismatch throws
 * when the query is built, not when it is run.
 */
export type ColumnMap = Readonly<Record<string, PgColumn>>;

/**
 * What a repository's `list` returns: the rows of the requested page and the
 * total the same `where` matches without `limit`/`offset`.
 *
 * Deliberately not a `Page<T>`: the page echoes the resolved query back for
 * `meta` (ADR-0012), and it is the **service** that owns that assembly, via
 * {@link toPage}, after mapping rows to resources. A repository that built one
 * would be deciding what the response looks like.
 */
export interface ListResult<T> {
  readonly rows: readonly T[];
  readonly total: number;
}

/** What a repository spreads over its Drizzle query. */
export interface ListQueryPlan {
  readonly where: SQL | undefined;
  readonly orderBy: readonly SQL[];
  readonly limit: number;
  readonly offset: number;
}

const columnFor = (columns: ColumnMap, field: string): PgColumn => {
  const column = columns[field];

  if (column === undefined) {
    // Not a client error: the query schema already rejected any field outside
    // the allow-list, so reaching here means the allow-list and the column map
    // disagree. It surfaces as a 500 with a stack, which is what a wiring bug
    // deserves (ADR-0013).
    throw new Error(
      `List query names "${field}", which has no column in this module's column map (ADR-0014).`,
    );
  }

  return column;
};

/** Translates one parsed filter into a Drizzle condition. */
export const toCondition = (filter: Filter, columns: ColumnMap): SQL => {
  const column = columnFor(columns, filter.field);

  switch (filter.op) {
    case "eq":
      return eq(column, filter.value);
    case "in":
      return inArray(column, [...filter.value]);
    case "gt":
      return gt(column, filter.value);
    case "gte":
      return gte(column, filter.value);
    case "lt":
      return lt(column, filter.value);
    case "lte":
      return lte(column, filter.value);
    case "like":
      return ilike(column, filter.value);
    case "null":
      return filter.value ? isNull(column) : isNotNull(column);
  }
};

export interface ApplyListQueryOptions {
  /** API field name → column, covering every sortable and filterable field. */
  readonly columns: ColumnMap;
  /**
   * The column appended to `ORDER BY` as a tiebreaker, normally the table's
   * `id`. Two rows with an equal sort key would otherwise be free to swap
   * between pages, so an offset paginator can show one twice and skip another
   * (ADR-0014 §Determinism). It is **not** added to `query.sort`, and so never
   * appears in `meta.sort`: it is a statement about SQL, not about what the
   * client asked for.
   */
  readonly tiebreaker: PgColumn;
  /**
   * Extra conditions the module contributes — a `q` search across its own
   * columns, a soft-delete or tenancy scope. ANDed with the parsed filters.
   */
  readonly extraWhere?: readonly (SQL | undefined)[];
}

/**
 * Turns a parsed {@link ListQuery} into the pieces of a Drizzle query.
 *
 * Returns the parts rather than mutating a query builder: Drizzle's builder is
 * chained and its type changes at every step, so handing it in and out of a
 * helper is what loses the row type.
 *
 * ```ts
 * const plan = applyListQuery(query, { columns, tiebreaker: staff.id });
 * const rows = await tx.select().from(staff)
 *   .where(plan.where).orderBy(...plan.orderBy)
 *   .limit(plan.limit).offset(plan.offset);
 * ```
 */
export const applyListQuery = (
  query: ListQuery,
  { columns, tiebreaker, extraWhere = [] }: ApplyListQueryOptions,
): ListQueryPlan => {
  const conditions = [
    ...query.filters.map((filter) => toCondition(filter, columns)),
    ...extraWhere,
  ].filter((condition): condition is SQL => condition !== undefined);

  const orderBy = query.sort.map((spec) => {
    const column = columnFor(columns, spec.field);

    return spec.direction === "desc" ? desc(column) : asc(column);
  });

  return {
    where: conditions.length === 0 ? undefined : and(...conditions),
    orderBy: [...orderBy, asc(tiebreaker)],
    limit: query.limit,
    offset: query.offset,
  };
};

/** `%`, `_` and the escape character itself, which `q` must not smuggle in. */
const LIKE_METACHARACTERS = /[\\%_]/g;

/**
 * Escapes a free-text term so a `LIKE`/`ILIKE` pattern matches it literally.
 *
 * `q` is a search term, not a pattern: a client typing `100%` means the four
 * characters, and an unescaped `%` would turn a prefix search into a full scan
 * that matches everything. `\` is Postgres' default escape character, so it has
 * to be escaped first — the single character class does both in one pass.
 */
export const escapeLikePattern = (term: string): string =>
  term.replace(LIKE_METACHARACTERS, (character) => `\\${character}`);

/**
 * The `q` parameter of ADR-0014 as a condition: case-insensitive containment
 * across the columns the endpoint declares searchable, ORed together.
 *
 * Returns `undefined` when there is no term, so it drops straight into
 * `extraWhere` without the caller branching.
 */
export const toSearchCondition = (
  columns: readonly PgColumn[],
  term: string | undefined,
): SQL | undefined => {
  if (term === undefined || columns.length === 0) return undefined;

  const pattern = `%${escapeLikePattern(term)}%`;

  return or(...columns.map((column) => ilike(column, pattern)));
};

/**
 * Assembles the `Page<T>` a service returns (ADR-0014), echoing the resolved
 * query back so `respond.list` can fill `meta` without seeing the request.
 */
export const toPage = <T>(
  query: ListQuery,
  items: readonly T[],
  total: number | null,
): Page<T> => ({
  items,
  total,
  offset: query.offset,
  limit: query.limit,
  sort: query.sort,
  filters: filtersToRecord(query.filters),
});
