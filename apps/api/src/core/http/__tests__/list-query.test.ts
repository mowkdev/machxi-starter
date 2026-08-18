import { listQuerySchema, type ListQuery } from "@repo/contracts";
import { staff } from "@repo/db";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  applyListQuery,
  escapeLikePattern,
  toCondition,
  toPage,
  toSearchCondition,
} from "../index.js";

/**
 * ADR-0014: the Drizzle half of the list machinery. The parser is tested in
 * `@repo/contracts`; what matters here is that a parsed query becomes the SQL
 * the ADR promises — allow-listed columns only, and a deterministic order.
 */

// Same casing as `createDb` (ADR-0006), so the rendered SQL names the
// physical columns the API actually queries.
const dialect = new PgDialect({ casing: "snake_case" });

const render = (fragment: Parameters<PgDialect["sqlToQuery"]>[0]): string =>
  dialect.sqlToQuery(fragment).sql;

const columns = {
  createdAt: staff.createdAt,
  email: staff.email,
  status: staff.status,
} as const;

const schema = listQuerySchema({
  sortable: ["createdAt", "email"],
  filterable: {
    status: { ops: ["eq", "in"], value: z.enum(["active", "disabled"]) },
    email: { ops: ["like"] },
    // `value` must parse to the column's TypeScript type, not to a string:
    // Drizzle hands the bound value to the column's driver mapper, and a
    // `timestamp` mapper calls `toISOString()` on it.
    createdAt: { ops: ["gte", "lt"], value: z.coerce.date() },
  },
  defaultSort: "-createdAt",
});

const parse = (query: Record<string, unknown>): ListQuery =>
  schema.parse(query);

describe("toCondition", () => {
  it.each([
    [{ status: "active" }, "="],
    [{ status: { in: "active,disabled" } }, "in"],
    [{ createdAt: { gte: "2026-01-01" } }, ">="],
    [{ createdAt: { lt: "2026-01-01" } }, "<"],
    [{ email: { like: "%40acme.com" } }, "ilike"],
  ])("renders %o with the %s operator", (filter, operator) => {
    const [parsed] = parse({ filter }).filters;

    expect(parsed).toBeDefined();
    expect(render(toCondition(parsed!, columns)).toLowerCase()).toContain(
      operator,
    );
  });

  it("refuses a field the column map does not cover", () => {
    // The query schema allow-lists fields; a gap here is a wiring bug between
    // the allow-list and the column map, so it must be loud, not silent.
    expect(() =>
      toCondition({ field: "ghost", op: "eq", value: "x" }, columns),
    ).toThrow(/column map/);
  });
});

describe("applyListQuery", () => {
  it("ANDs the parsed filters", () => {
    const plan = applyListQuery(
      parse({ filter: { status: "active", email: { like: "%acme%" } } }),
      { columns, tiebreaker: staff.id },
    );

    expect(plan.where).toBeDefined();
    expect(render(plan.where!).toLowerCase()).toContain(" and ");
  });

  it("leaves `where` undefined when nothing was filtered", () => {
    expect(
      applyListQuery(parse({}), { columns, tiebreaker: staff.id }).where,
    ).toBeUndefined();
  });

  it("appends the id tiebreaker so pages are stable", () => {
    const plan = applyListQuery(parse({ sort: "email" }), {
      columns,
      tiebreaker: staff.id,
    });

    expect(plan.orderBy).toHaveLength(2);
    expect(render(sql.join([...plan.orderBy], sql`, `))).toMatch(
      /"email" asc, .*"id" asc/,
    );
  });

  it("does not put the tiebreaker into the reported sort", () => {
    // `meta.sort` states what the client asked for; the tiebreaker is a
    // statement about SQL determinism (ADR-0014).
    const query = parse({ sort: "email" });

    expect(query.sort).toEqual([{ field: "email", direction: "asc" }]);
  });

  it("applies the default sort when the client sent none", () => {
    const plan = applyListQuery(parse({}), { columns, tiebreaker: staff.id });

    expect(render(sql.join([...plan.orderBy], sql`, `))).toMatch(
      /"created_at" desc/,
    );
  });

  it("carries limit and offset through unchanged", () => {
    const plan = applyListQuery(parse({ offset: "40", limit: "25" }), {
      columns,
      tiebreaker: staff.id,
    });

    expect(plan).toMatchObject({ limit: 25, offset: 40 });
  });

  it("ANDs the module's own conditions with the parsed ones", () => {
    const plan = applyListQuery(parse({ filter: { status: "active" } }), {
      columns,
      tiebreaker: staff.id,
      extraWhere: [sql`${staff.email} is not null`, undefined],
    });

    const rendered = render(plan.where!).toLowerCase();

    expect(rendered).toContain("is not null");
    expect(rendered).toContain(" and ");
  });

  it("uses only the module's condition when there are no filters", () => {
    const plan = applyListQuery(parse({}), {
      columns,
      tiebreaker: staff.id,
      extraWhere: [sql`${staff.email} is not null`],
    });

    expect(render(plan.where!).toLowerCase()).toContain("is not null");
  });
});

describe("toPage", () => {
  it("echoes the resolved query back for `meta`", () => {
    const query = parse({ filter: { status: "active" }, sort: "email" });
    const page = toPage(query, [{ id: "1" }], 1);

    expect(page).toEqual({
      items: [{ id: "1" }],
      total: 1,
      offset: 0,
      limit: 20,
      sort: [{ field: "email", direction: "asc" }],
      filters: { status: "active" },
    });
  });

  it("keeps the operator in the key for a non-eq filter", () => {
    const page = toPage(
      parse({ filter: { createdAt: { gte: "2026-01-01" } } }),
      [],
      0,
    );

    // The *parsed* value, not the raw query string: what is echoed is what
    // was applied. It serialises to an ISO-8601 instant (ADR-0012).
    expect(page.filters).toEqual({ "createdAt[gte]": new Date("2026-01-01") });
    expect(JSON.parse(JSON.stringify(page.filters))).toEqual({
      "createdAt[gte]": "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("escapeLikePattern", () => {
  it.each([
    ["100%", String.raw`100\%`],
    ["a_b", String.raw`a\_b`],
    [String.raw`back\slash`, String.raw`back\\slash`],
    // Not `String.raw` here: a template literal may not end in a backslash.
    ["%_\\", "\\%\\_\\\\"],
  ])("escapes %j", (term, expected) => {
    expect(escapeLikePattern(term)).toBe(expected);
  });

  it("leaves an ordinary term alone", () => {
    expect(escapeLikePattern("anna@acme.com")).toBe("anna@acme.com");
  });
});

describe("toSearchCondition", () => {
  it("ORs a containment match across the searchable columns", () => {
    const condition = toSearchCondition([staff.email, staff.firstName], "anna");

    expect(condition).toBeDefined();
    expect(render(condition!).toLowerCase()).toMatch(
      /"email" ilike .* or .*"first_name" ilike/,
    );
  });

  it("binds the term wrapped in wildcards", () => {
    const condition = toSearchCondition([staff.email], "anna");

    expect(dialect.sqlToQuery(condition!).params).toEqual(["%anna%"]);
  });

  it("treats `%` and `_` in the term as literal characters", () => {
    // `q` is a search term, not a pattern (ADR-0014). An unescaped `%` would
    // turn "find the accounts mentioning a percent sign" into "match
    // everything", which is the difference between a filter and no filter.
    expect(
      dialect.sqlToQuery(toSearchCondition([staff.email], "50%")!).params,
    ).toEqual([String.raw`%50\%%`]);
    expect(
      dialect.sqlToQuery(toSearchCondition([staff.email], "a_b")!).params,
    ).toEqual([String.raw`%a\_b%`]);
  });

  it("is undefined without a term, so it drops into `extraWhere` unbranched", () => {
    expect(toSearchCondition([staff.email], undefined)).toBeUndefined();
  });

  it("is undefined when the endpoint declares no searchable columns", () => {
    expect(toSearchCondition([], "anna")).toBeUndefined();
  });
});
