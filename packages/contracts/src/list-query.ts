import { z } from "zod";
import { sortSpecSchema } from "./envelope.js";

import type { SortDirection } from "./enums.js";
import type { Pagination, SortSpec } from "./envelope.js";

/**
 * The list-query language shared by every collection endpoint (ADR-0014) and
 * the schema builder that parses it.
 *
 * The builder lives here rather than in the API because ADR-0023 puts
 * `listStaffQuery` / `listUsersQuery` in this package, and a per-module query
 * schema cannot be built without it. It is pure zod — no Express, no Drizzle —
 * so it satisfies the "contracts depends only on zod" rule. The API's
 * `core/http/list-query.ts` re-exports it and adds `applyListQuery`, which is
 * where Drizzle and the `id asc` tiebreaker belong.
 */

/** Query-string parameter names, for clients assembling a URL. */
export const LIST_QUERY_PARAMS = {
  offset: "offset",
  limit: "limit",
  sort: "sort",
  filter: "filter",
  q: "q",
  count: "count",
} as const;

/**
 * Filter operators, expressed as a bracket suffix: `filter[status][in]=a,b`.
 * A bare `filter[status]=active` means `eq`.
 *
 * | Op | Query | Meaning |
 * |---|---|---|
 * | `eq` | `filter[status]=active` | equality (the default) |
 * | `in` | `filter[status][in]=active,invited` | one of a comma-separated list |
 * | `gt` `gte` `lt` `lte` | `filter[createdAt][gte]=2026-01-01` | ordered comparison |
 * | `like` | `filter[email][like]=%40acme.com` | case-insensitive ILIKE pattern |
 * | `null` | `filter[deletedAt][null]=true` | IS NULL / IS NOT NULL |
 */
export const FILTER_OPS = [
  "eq",
  "in",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "null",
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

/** Operators whose value is a single scalar of the field's own type. */
export const SCALAR_FILTER_OPS = ["eq", "gt", "gte", "lt", "lte"] as const;
export type ScalarFilterOp = (typeof SCALAR_FILTER_OPS)[number];

/** One parsed filter. The operator discriminates the value's shape. */
export type Filter =
  | {
      readonly field: string;
      readonly op: ScalarFilterOp;
      readonly value: unknown;
    }
  | {
      readonly field: string;
      readonly op: "in";
      readonly value: readonly unknown[];
    }
  | { readonly field: string; readonly op: "like"; readonly value: string }
  | { readonly field: string; readonly op: "null"; readonly value: boolean };

/**
 * What an endpoint allows on one filterable field.
 *
 * `value` parses a single scalar, and each member of an `in` list; it defaults
 * to a bounded non-empty string. `like` always takes a raw string pattern and
 * `null` always a boolean, whatever `value` says — `%40acme.com` is a pattern,
 * not a value of the column's type.
 */
export interface FilterFieldSpec {
  readonly ops: readonly FilterOp[];
  readonly value?: z.ZodType;
}

/** The filterable allow-list of an endpoint: field name to what it accepts. */
export type FilterSpec = Readonly<Record<string, FilterFieldSpec>>;

/** What a list controller hands to its service (ADR-0014). */
export interface ListQuery {
  readonly offset: number;
  readonly limit: number;
  readonly sort: readonly SortSpec[];
  readonly filters: readonly Filter[];
  readonly q?: string;
  /**
   * Whether the caller wants `meta.pagination.total` (ADR-0060 §2).
   *
   * `false` tells the repository to skip the aggregate and report
   * `total: null` — the branch {@link Page} has typed since D1.4 and nothing
   * could take. Defaults to `true`, because an admin grid wants its page
   * count and only the call site that has become expensive knows it has.
   */
  readonly count: boolean;
}

/**
 * What a service returns for a list, before `respond.list` turns it into a
 * `ListEnvelope` (ADR-0012). Pure data, so it lives beside {@link ListQuery}
 * and the list plumbing has one home.
 */
export interface Page<T> {
  readonly items: readonly T[];
  readonly total: Pagination["total"];
  readonly offset: number;
  readonly limit: number;
  readonly sort: readonly SortSpec[];
  readonly filters: Readonly<Record<string, unknown>>;
}

/** Default page size when the client sends no `limit` (ADR-0014). */
export const DEFAULT_LIMIT = 20;

/** Hard ceiling on `limit`; no endpoint may raise its `maxLimit` above this. */
export const MAX_LIMIT = 100;

/**
 * Hard ceiling on `offset` (ADR-0060 §1).
 *
 * `limit` has been bounded since D1.4 and `offset` carried only `.min(0)`, so
 * `?offset=50000000` was a legal request Postgres answered by walking fifty
 * million rows. Beyond this the API answers `400 VALIDATION_ERROR` through the
 * ordinary validation path (ADR-0011, ADR-0013) — a bound spelled like every
 * other bound, with no special case in a controller. (ADR-0060 §1 said `422`
 * when it was written; it is amended, because a status the ordinary path does
 * not use could only have come from the special case the decision refuses.)
 *
 * The successor for a list that genuinely needs to go deeper is **keyset
 * pagination on `(sort key, id)`**, which ADR-0060 §1 names and deliberately
 * does not build: the `id` tiebreaker `applyListQuery` already appends is the
 * second half of that key, but the first half is a contract change.
 */
export const MAX_OFFSET = 10_000;

/** Longest accepted free-text `q` term. */
export const MAX_SEARCH_LENGTH = 200;

/** Longest accepted `like` pattern and `sort` expression. */
const MAX_LIKE_LENGTH = 200;
const MAX_SORT_LENGTH = 200;

const defaultValueSchema = z.string().min(1).max(MAX_SEARCH_LENGTH);
const likeValueSchema = z.string().min(1).max(MAX_LIKE_LENGTH);
const nullValueSchema = z
  .enum(["true", "false"])
  .transform((v) => v === "true");

/** Options for {@link listQuerySchema}. */
export interface ListQueryOptions {
  /** Fields the client may sort by; anything else is a `VALIDATION_ERROR`. */
  readonly sortable: readonly string[];
  /** Fields the client may filter by, and with which operators. */
  readonly filterable?: FilterSpec;
  /** Applied when the client sends no `sort`, e.g. `"-createdAt"`. */
  readonly defaultSort: string;
  /** Per-endpoint page-size ceiling; may not exceed {@link MAX_LIMIT}. */
  readonly maxLimit?: number;
  /**
   * Page size when the client sends no `limit`. Defaults to
   * {@link DEFAULT_LIMIT}, or to `maxLimit` when that is lower.
   */
  readonly defaultLimit?: number;
  /** Whether this endpoint implements free-text `q` search. */
  readonly searchable?: boolean;
}

type SortParseResult =
  | { ok: true; sort: SortSpec[] }
  | { ok: false; token: string; reason: "unknown" | "duplicate" };

/**
 * Parses one `sort` string (`"-createdAt,email"`) into {@link SortSpec}s.
 *
 * Returns the offending token instead of throwing, so the caller decides
 * whether that is a zod issue (client input) or a wiring bug (`defaultSort`).
 */
const parseSort = (
  raw: string,
  sortable: readonly string[],
): SortParseResult => {
  const sort: SortSpec[] = [];
  const seen = new Set<string>();

  for (const token of raw.split(",").map((entry) => entry.trim())) {
    if (token === "") continue;

    const descending = token.startsWith("-");
    const direction: SortDirection = descending ? "desc" : "asc";
    const field = descending ? token.slice(1) : token;

    if (!sortable.includes(field))
      return { ok: false, token, reason: "unknown" };
    if (seen.has(field)) return { ok: false, token, reason: "duplicate" };

    seen.add(field);
    sort.push({ field, direction });
  }

  return { ok: true, sort };
};

/**
 * Builds the query schema of a list endpoint from its allow-lists.
 *
 * ```ts
 * export const listStaffQuery = listQuerySchema({
 *   sortable: ["createdAt", "email", "status"],
 *   filterable: { status: { ops: ["eq", "in"], value: z.enum(STAFF_STATUSES) } },
 *   defaultSort: "-createdAt",
 * });
 * ```
 *
 * The result is strict: an unknown top-level parameter is a typo and earns a
 * `VALIDATION_ERROR` rather than being silently ignored (ADR-0011). Unknown
 * sort fields, unknown filter fields and operators not allow-listed for a
 * field are rejected the same way, which is what keeps clients off
 * non-indexed and sensitive columns (ADR-0014).
 *
 * @throws TypeError if `defaultSort`, `maxLimit` or `defaultLimit` contradict
 *   the allow-lists — a wiring bug, surfaced when the router is built rather
 *   than on the first request.
 */
/**
 * The **parsed** list query, as a schema.
 *
 * {@link listQuerySchema} parses the *wire* form and outputs this one, which
 * makes it unusable for anything that has to re-read what it produced: a
 * browser URL holding a validated list state is exactly that case, and a router
 * that round-trips its own output through the wire schema gets
 * `expected string, received array` on `sort` and an unrecognised `filters`.
 *
 * Verified rather than assumed \u2014 `listStaffQuery.safeParse(listStaffQuery.parse({}))`
 * fails \u2014 which is why this exists as its own export rather than as an
 * `.and()` on the builder.
 *
 * It validates shape, not allow-lists: the endpoint's `sortable` and
 * `filterable` sets are enforced by {@link listQuerySchema} when the request
 * reaches the API, and re-stating them here would be a second place to keep
 * them. What this guarantees is that a client holding a parsed query in a URL
 * can read it back as the same object it wrote.
 */
export const filterSchema: z.ZodType<Filter> = z.union([
  z.object({
    field: z.string(),
    op: z.enum(SCALAR_FILTER_OPS),
    value: z.unknown(),
  }),
  z.object({
    field: z.string(),
    op: z.literal("in"),
    value: z.array(z.unknown()),
  }),
  z.object({ field: z.string(), op: z.literal("like"), value: z.string() }),
  z.object({ field: z.string(), op: z.literal("null"), value: z.boolean() }),
]) as z.ZodType<Filter>;

export const listQuerySearchSchema = z.object({
  offset: z.number().int().min(0).max(MAX_OFFSET).default(0),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  sort: z.array(sortSpecSchema).default([]),
  filters: z.array(filterSchema).default([]),
  q: z.string().min(1).max(MAX_SEARCH_LENGTH).optional(),
  // Defaulted rather than optional, so a router holding a parsed query always
  // holds the flag's real value and `stripSearchParams` can drop it when it
  // equals the default (ADR-0060 §2).
  count: z.boolean().default(true),
});

export type ListQuerySearch = z.infer<typeof listQuerySearchSchema>;

export const listQuerySchema = (options: ListQueryOptions) => {
  const {
    sortable,
    filterable = {},
    defaultSort,
    maxLimit = MAX_LIMIT,
    searchable = false,
  } = options;

  if (!Number.isInteger(maxLimit) || maxLimit < 1 || maxLimit > MAX_LIMIT) {
    throw new TypeError(
      `listQuerySchema: maxLimit must be an integer in [1, ${String(MAX_LIMIT)}], got ${String(maxLimit)}`,
    );
  }

  // An endpoint that lowers its ceiling below the shared default gets the
  // ceiling as its page size; it should not have to restate defaultLimit.
  const defaultLimit =
    options.defaultLimit ?? Math.min(DEFAULT_LIMIT, maxLimit);

  if (
    !Number.isInteger(defaultLimit) ||
    defaultLimit < 1 ||
    defaultLimit > maxLimit
  ) {
    throw new TypeError(
      `listQuerySchema: defaultLimit must be an integer in [1, ${String(maxLimit)}], got ${String(defaultLimit)}`,
    );
  }

  const parsedDefaultSort = parseSort(defaultSort, sortable);
  if (!parsedDefaultSort.ok) {
    throw new TypeError(
      `listQuerySchema: defaultSort "${defaultSort}" uses a ${parsedDefaultSort.reason} field ` +
        `("${parsedDefaultSort.token}"); sortable: ${sortable.join(", ")}`,
    );
  }
  const fallbackSort = parsedDefaultSort.sort;

  const rawFilterValue = z.union([
    z.string(),
    z.record(z.string(), z.string()),
  ]);

  const shape = {
    offset: z.coerce.number().int().min(0).max(MAX_OFFSET).default(0),
    limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
    sort: z.string().max(MAX_SORT_LENGTH).optional(),
    filter: z.record(z.string(), rawFilterValue).optional(),
    q: z.string().trim().min(1).max(MAX_SEARCH_LENGTH).optional(),
    // `z.coerce.boolean()` is not this: it is JavaScript truthiness, and the
    // string "false" is truthy. A query string carries characters, so the two
    // words are the schema (the `filter[x][null]` value above, for the same
    // reason).
    count: z.enum(["true", "false"]).default("true"),
  };

  return z.strictObject(shape).transform((raw, ctx): ListQuery => {
    const sortResult =
      raw.sort === undefined ? null : parseSort(raw.sort, sortable);

    if (sortResult !== null && !sortResult.ok) {
      ctx.addIssue({
        code: "custom",
        path: [LIST_QUERY_PARAMS.sort],
        message:
          sortResult.reason === "unknown"
            ? `Cannot sort by "${sortResult.token}". Sortable fields: ${sortable.join(", ")}`
            : `Duplicate sort field "${sortResult.token}"`,
      });
    }

    if (!searchable && raw.q !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: [LIST_QUERY_PARAMS.q],
        message: "This endpoint does not support free-text search",
      });
    }

    const filters: Filter[] = [];

    for (const [field, rawValue] of Object.entries(raw.filter ?? {})) {
      const fieldPath: (string | number)[] = [LIST_QUERY_PARAMS.filter, field];
      const spec = filterable[field];

      if (spec === undefined) {
        const allowed = Object.keys(filterable);
        ctx.addIssue({
          code: "custom",
          path: fieldPath,
          message: `Cannot filter by "${field}". Filterable fields: ${allowed.length > 0 ? allowed.join(", ") : "none"}`,
        });
        continue;
      }

      const byOp: Record<string, string> =
        typeof rawValue === "string" ? { eq: rawValue } : rawValue;

      for (const [op, value] of Object.entries(byOp)) {
        const opPath =
          typeof rawValue === "string" ? fieldPath : [...fieldPath, op];

        if (!isFilterOp(op) || !spec.ops.includes(op)) {
          ctx.addIssue({
            code: "custom",
            path: opPath,
            message: `Operator "${op}" is not allowed on "${field}". Allowed: ${spec.ops.join(", ")}`,
          });
          continue;
        }

        if (op === "null") {
          const parsed = nullValueSchema.safeParse(value);
          if (!parsed.success) {
            ctx.addIssue({
              code: "custom",
              path: opPath,
              message: `Filter "${field}[null]" must be "true" or "false"`,
            });
            continue;
          }
          filters.push({ field, op, value: parsed.data });
          continue;
        }

        if (op === "like") {
          const parsed = likeValueSchema.safeParse(value);
          if (!parsed.success) {
            ctx.addIssue({
              code: "custom",
              path: opPath,
              message: `Filter "${field}[like]" must be 1-${String(MAX_LIKE_LENGTH)} characters`,
            });
            continue;
          }
          filters.push({ field, op, value: parsed.data });
          continue;
        }

        const valueSchema = spec.value ?? defaultValueSchema;

        if (op === "in") {
          const members = value
            .split(",")
            .map((member) => member.trim())
            .filter((member) => member !== "");

          if (members.length === 0) {
            ctx.addIssue({
              code: "custom",
              path: opPath,
              message: `Filter "${field}[in]" must list at least one value`,
            });
            continue;
          }

          const parsedMembers: unknown[] = [];
          let allValid = true;

          for (const [index, member] of members.entries()) {
            const parsed = valueSchema.safeParse(member);
            if (!parsed.success) {
              allValid = false;
              for (const issue of parsed.error.issues) {
                ctx.addIssue({
                  code: "custom",
                  path: [...opPath, index],
                  message: issue.message,
                });
              }
              continue;
            }
            parsedMembers.push(parsed.data);
          }

          if (allValid) filters.push({ field, op, value: parsedMembers });
          continue;
        }

        const parsed = valueSchema.safeParse(value);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            ctx.addIssue({
              code: "custom",
              path: opPath,
              message: issue.message,
            });
          }
          continue;
        }

        filters.push({ field, op, value: parsed.data });
      }
    }

    const sort =
      sortResult !== null && sortResult.ok && sortResult.sort.length > 0
        ? sortResult.sort
        : fallbackSort;
    const q = searchable ? raw.q : undefined;

    return {
      offset: raw.offset,
      limit: raw.limit,
      sort,
      filters,
      count: raw.count === "true",
      ...(q === undefined ? {} : { q }),
    };
  });
};

const isFilterOp = (op: string): op is FilterOp =>
  (FILTER_OPS as readonly string[]).includes(op);

/**
 * Collapses parsed filters into the flat record echoed as `meta.filters`
 * (ADR-0012), so a client can restore its table state from the response alone.
 * A non-`eq` filter keeps its operator in the key (`createdAt[gte]`), matching
 * the query string that produced it.
 */
export const filtersToRecord = (
  filters: readonly Filter[],
): Record<string, unknown> =>
  Object.fromEntries(
    filters.map((filter) => [
      filter.op === "eq" ? filter.field : `${filter.field}[${filter.op}]`,
      filter.value,
    ]),
  );
