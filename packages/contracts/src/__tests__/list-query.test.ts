import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  filtersToRecord,
  listQuerySchema,
  type Filter,
} from "../index.js";

const schema = listQuerySchema({
  sortable: ["createdAt", "email", "status"],
  filterable: {
    status: {
      ops: ["eq", "in"],
      value: z.enum(["active", "invited", "disabled"]),
    },
    email: { ops: ["eq", "like"], value: z.string().min(3) },
    createdAt: { ops: ["gt", "gte", "lt", "lte"], value: z.coerce.date() },
    deletedAt: { ops: ["null"] },
  },
  defaultSort: "-createdAt",
  searchable: true,
});

const parse = (query: unknown) => schema.safeParse(query);

const issuePaths = (result: ReturnType<typeof parse>): string[] =>
  result.success
    ? []
    : result.error.issues.map((issue) => issue.path.join("."));

describe("listQuerySchema — defaults", () => {
  it("fills offset, limit and the default sort from an empty query", () => {
    const result = parse({});

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      offset: 0,
      limit: DEFAULT_LIMIT,
      sort: [{ field: "createdAt", direction: "desc" }],
      filters: [],
    });
  });

  it("coerces the numeric params, which arrive as strings from a query string", () => {
    const result = parse({ offset: "40", limit: "5" });

    expect(result.data?.offset).toBe(40);
    expect(result.data?.limit).toBe(5);
  });

  it("falls back to the default sort when sort is empty or only separators", () => {
    expect(parse({ sort: "" }).data?.sort).toEqual([
      { field: "createdAt", direction: "desc" },
    ]);
    expect(parse({ sort: " , " }).data?.sort).toEqual([
      { field: "createdAt", direction: "desc" },
    ]);
  });
});

describe("listQuerySchema — bounds", () => {
  it("rejects a negative offset and a zero or over-cap limit (ADR-0014)", () => {
    expect(parse({ offset: "-1" }).success).toBe(false);
    expect(parse({ limit: "0" }).success).toBe(false);
    expect(parse({ limit: String(MAX_LIMIT + 1) }).success).toBe(false);
    expect(parse({ limit: String(MAX_LIMIT) }).success).toBe(true);
  });

  it("rejects non-integers rather than truncating them", () => {
    expect(parse({ limit: "2.5" }).success).toBe(false);
    expect(parse({ offset: "abc" }).success).toBe(false);
  });

  it("honours a per-endpoint maxLimit below the hard cap", () => {
    const capped = listQuerySchema({
      sortable: ["id"],
      defaultSort: "id",
      maxLimit: 10,
    });

    expect(capped.safeParse({ limit: "10" }).success).toBe(true);
    expect(capped.safeParse({ limit: "11" }).success).toBe(false);
  });

  it("refuses to build an endpoint whose configuration contradicts itself", () => {
    expect(() =>
      listQuerySchema({ sortable: ["id"], defaultSort: "createdAt" }),
    ).toThrow(TypeError);
    expect(() =>
      listQuerySchema({ sortable: ["id"], defaultSort: "id,id" }),
    ).toThrow(TypeError);
    expect(() =>
      listQuerySchema({ sortable: ["id"], defaultSort: "id", maxLimit: 1000 }),
    ).toThrow(TypeError);
    expect(() =>
      listQuerySchema({
        sortable: ["id"],
        defaultSort: "id",
        maxLimit: 5,
        defaultLimit: 6,
      }),
    ).toThrow(TypeError);
  });
});

describe("listQuerySchema — sort", () => {
  it("reads direction from the leading dash and preserves order", () => {
    expect(parse({ sort: "-createdAt,email" }).data?.sort).toEqual([
      { field: "createdAt", direction: "desc" },
      { field: "email", direction: "asc" },
    ]);
  });

  it("rejects a field that is not sortable and names the allowed ones", () => {
    const result = parse({ sort: "passwordHash" });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(["sort"]);
    expect(result.error?.issues[0]?.message).toContain(
      "createdAt, email, status",
    );
  });

  it("rejects a repeated field instead of silently picking one", () => {
    expect(parse({ sort: "email,-email" }).success).toBe(false);
  });
});

describe("listQuerySchema — filters", () => {
  it("treats a bare value as eq", () => {
    expect(parse({ filter: { status: "active" } }).data?.filters).toEqual([
      { field: "status", op: "eq", value: "active" },
    ]);
  });

  it("splits an in list and validates every member", () => {
    expect(
      parse({ filter: { status: { in: "active, invited" } } }).data?.filters,
    ).toEqual([{ field: "status", op: "in", value: ["active", "invited"] }]);

    const bad = parse({ filter: { status: { in: "active,bogus" } } });
    expect(bad.success).toBe(false);
    expect(issuePaths(bad)).toEqual(["filter.status.in.1"]);
  });

  it("rejects an in list with nothing in it", () => {
    expect(parse({ filter: { status: { in: " , " } } }).success).toBe(false);
  });

  it("applies the field value schema to comparison operators", () => {
    const result = parse({ filter: { createdAt: { gte: "2026-01-01" } } });
    const filter = result.data?.filters[0];

    expect(filter?.op).toBe("gte");
    expect(filter?.value).toBeInstanceOf(Date);
    expect(
      parse({ filter: { createdAt: { gte: "not-a-date" } } }).success,
    ).toBe(false);
  });

  it("keeps a like pattern as a raw string, bypassing the field value schema", () => {
    expect(
      parse({ filter: { email: { like: "%40acme.com" } } }).data?.filters,
    ).toEqual([{ field: "email", op: "like", value: "%40acme.com" }]);
  });

  it("turns a null filter into a boolean and rejects anything else", () => {
    expect(
      parse({ filter: { deletedAt: { null: "true" } } }).data?.filters,
    ).toEqual([{ field: "deletedAt", op: "null", value: true }]);
    expect(
      parse({ filter: { deletedAt: { null: "false" } } }).data?.filters,
    ).toEqual([{ field: "deletedAt", op: "null", value: false }]);
    expect(parse({ filter: { deletedAt: { null: "1" } } }).success).toBe(false);
  });

  it("accepts several operators on one field", () => {
    const result = parse({
      filter: { createdAt: { gte: "2026-01-01", lt: "2026-02-01" } },
    });

    expect(result.data?.filters).toHaveLength(2);
  });

  it("rejects a field that is not filterable, keeping clients off other columns", () => {
    const result = parse({ filter: { passwordHash: "x" } });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(["filter.passwordHash"]);
  });

  it("rejects an operator the field does not allow", () => {
    const result = parse({ filter: { status: { like: "act%" } } });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(["filter.status.like"]);
    expect(result.error?.issues[0]?.message).toContain("eq, in");
  });

  it("rejects an operator that is not an operator at all", () => {
    expect(parse({ filter: { status: { regex: "^a" } } }).success).toBe(false);
  });

  it("reports every offending filter, not just the first", () => {
    const result = parse({ filter: { nope: "1", status: { like: "x" } } });

    expect(issuePaths(result)).toEqual(["filter.nope", "filter.status.like"]);
  });
});

describe("listQuerySchema — q and unknown params", () => {
  it("trims and keeps q when the endpoint is searchable", () => {
    expect(parse({ q: "  anna  " }).data?.q).toBe("anna");
  });

  it("omits q entirely when absent", () => {
    const result = parse({});

    expect(result.success).toBe(true);
    expect(result.data && "q" in result.data).toBe(false);
  });

  it("rejects q on an endpoint that does not search", () => {
    const plain = listQuerySchema({ sortable: ["id"], defaultSort: "id" });
    const result = plain.safeParse({ q: "anna" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path.join(".")).toBe("q");
  });

  it("rejects an unknown top-level parameter so a typo is not silently ignored", () => {
    expect(parse({ page: "2" }).success).toBe(false);
    expect(parse({ fitler: { status: "active" } }).success).toBe(false);
  });
});

describe("filtersToRecord", () => {
  it("keeps the operator in the key for everything but eq", () => {
    const filters: Filter[] = [
      { field: "status", op: "eq", value: "active" },
      { field: "status", op: "in", value: ["active", "invited"] },
      { field: "createdAt", op: "gte", value: "2026-01-01" },
      { field: "deletedAt", op: "null", value: true },
    ];

    expect(filtersToRecord(filters)).toEqual({
      status: "active",
      "status[in]": ["active", "invited"],
      "createdAt[gte]": "2026-01-01",
      "deletedAt[null]": true,
    });
  });

  it("is empty for no filters", () => {
    expect(filtersToRecord([])).toEqual({});
  });
});
