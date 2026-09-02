import { listStaffQuery } from "@repo/contracts";
import { describe, expect, it } from "vitest";

import { serializeListParams, toListQuery } from "../list-params";

/**
 * The axios adapter, which after ADR-0043 is the only thing left here: the
 * list-query *syntax* lives in `@repo/contracts` and is tested there, as one
 * round-trip property.
 *
 * What this file still owes is the branch — a list query goes through the
 * canonical writer, an ordinary parameter bag does not — and the cross-check
 * that the string the client sends is one the endpoint's own schema accepts.
 * That second test is the one that fails loudly if either side ever moves.
 */

describe("list params", () => {
  it("writes a list query with the canonical, readable syntax", () => {
    const written = serializeListParams({
      offset: 20,
      limit: 50,
      sort: [{ field: "createdAt", direction: "desc" }],
      filters: [
        { field: "status", op: "eq", value: "active" },
        { field: "roles", op: "in", value: ["admin", "manager"] },
      ],
      q: "ada",
    });

    // Brackets literal, `eq` bare, `-` for descending — the same string the
    // address bar shows for the same grid state.
    expect(written).toBe(
      "offset=20&limit=50&sort=-createdAt&filter[status]=active" +
        "&filter[roles][in]=admin%2Cmanager&q=ada",
    );
  });

  it("leaves an ordinary object alone", () => {
    // Every non-list request goes through the same serializer.
    expect(serializeListParams({ id: "abc", page: 2 })).toBe("id=abc&page=2");
  });

  it("produces a query string the endpoint's own schema accepts", () => {
    /*
     * The cross-check, against the real contract. `listStaffQuery` parses what
     * the API receives after Express has nested the brackets, so parsing what
     * the client wrote proves the two halves agree — and it fails the moment
     * either one moves. Driven from a parsed query rather than a literal, so
     * a `Date` value really is a `Date` (ADR-0014 step 7).
     */
    const query = listStaffQuery.parse({
      sort: "-createdAt",
      filter: { status: "active", createdAt: { gte: "2026-01-01" } },
    });

    const written = new URLSearchParams(serializeListParams(query));
    const nested: Record<string, unknown> = {};
    const filter: Record<string, unknown> = {};

    for (const [key, value] of written) {
      const match = /^filter\[([^\]]+)\](?:\[([^\]]+)\])?$/.exec(key);

      if (match) {
        const [, field, op] = match;
        filter[field as string] = op === undefined ? value : { [op]: value };
        continue;
      }

      nested[key] = value;
    }

    expect(written.get("filter[createdAt][gte]")).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(listStaffQuery.safeParse({ ...nested, filter }).success).toBe(true);
  });

  it("drops an absent search term rather than passing `undefined` through", () => {
    // The `exactOptionalPropertyTypes` hand-off `toListQuery` exists for.
    expect(
      toListQuery({ offset: 0, limit: 20, sort: [], filters: [], count: true }),
    ).not.toHaveProperty("q");
    expect(
      toListQuery({
        offset: 0,
        limit: 20,
        sort: [],
        filters: [],
        count: true,
        q: "ada",
      }),
    ).toHaveProperty("q", "ada");
  });
});
