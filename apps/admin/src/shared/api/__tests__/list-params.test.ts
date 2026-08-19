import { listStaffQuery } from "@repo/contracts";
import { describe, expect, it } from "vitest";

import { serializeListParams, toListParams } from "../list-params";

/**
 * The wire form of a list query (ADR-0014), which is the one thing between the
 * grid and the API that is a *string* rather than a validated object.
 *
 * The test that matters most is the round trip: what this writes must be what
 * `listStaffQuery` accepts. A serializer that looks right and produces
 * `sort=email:asc` is a `VALIDATION_ERROR` at runtime and nothing at build
 * time, which is exactly the failure the single pinned serializer exists to
 * prevent.
 */

const serialize = (query: Parameters<typeof toListParams>[0]) =>
  serializeListParams(toListParams(query));

describe("list params", () => {
  it("writes the ADR-0014 shapes", () => {
    const search = serialize({
      offset: 20,
      limit: 50,
      sort: [
        { field: "createdAt", direction: "desc" },
        { field: "email", direction: "asc" },
      ],
      filters: [
        { field: "status", op: "eq", value: "active" },
        { field: "roles", op: "in", value: ["admin", "manager"] },
        { field: "createdAt", op: "gte", value: "2026-01-01" },
      ],
      q: "ada",
    });

    const params = new URLSearchParams(search);

    // A leading `-` is descending, comma-separated, in order.
    expect(params.get("sort")).toBe("-createdAt,email");
    // `eq` is the bare shorthand; every other operator carries its bracket.
    expect(params.get("filter[status]")).toBe("active");
    expect(params.get("filter[roles][in]")).toBe("admin,manager");
    expect(params.get("filter[createdAt][gte]")).toBe("2026-01-01");
    expect(params.get("offset")).toBe("20");
    expect(params.get("limit")).toBe("50");
    expect(params.get("q")).toBe("ada");
  });

  it("produces a query string the API's own schema accepts", () => {
    /*
     * The round trip, against the real contract. `listStaffQuery` parses the
     * bracket syntax the API receives, so parsing what we wrote proves the two
     * halves agree — and it fails the moment either one moves.
     */
    const query = serialize({
      offset: 0,
      limit: 20,
      sort: [{ field: "email", direction: "asc" }],
      filters: [{ field: "status", op: "eq", value: "active" }],
    });

    const asRequest = Object.fromEntries(
      // Express nests `filter[status]` into `{ filter: { status } }`; this is
      // the minimum of that shape the schema needs to see.
      [...new URLSearchParams(query)].map(([key, value]) => [key, value]),
    );

    const nested: Record<string, unknown> = {};
    const filter: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(asRequest)) {
      const match = /^filter\[([^\]]+)\](?:\[([^\]]+)\])?$/.exec(key);

      if (match) {
        const [, field, op] = match;
        filter[field as string] = op === undefined ? value : { [op]: value };
        continue;
      }

      nested[key] = value;
    }

    const parsed = listStaffQuery.safeParse({ ...nested, filter });

    expect(parsed.success).toBe(true);
  });

  it("omits an empty search rather than sending one the schema rejects", () => {
    const search = serialize({
      offset: 0,
      limit: 20,
      sort: [],
      filters: [],
      q: "",
    });

    expect(new URLSearchParams(search).has("q")).toBe(false);
    // An empty sort is absent too, not `sort=`.
    expect(new URLSearchParams(search).has("sort")).toBe(false);
  });

  it("writes a date filter as an ISO instant, not a JS date string", () => {
    /*
     * Driven from the *contract* rather than hand-built, which is the whole
     * point: `listStaffQuery` declares its date fields `z.coerce.date()`, so
     * the parsed value really is a `Date` and `String(date)` would write a
     * locale- and timezone-dependent sentence. The earlier version of this
     * test passed a string literal, which `ListQuery`'s `unknown` value happily
     * accepted — and that is exactly why the bug was invisible.
     */
    const query = listStaffQuery.parse({
      filter: { createdAt: { gte: "2026-01-01" } },
    });

    const params = new URLSearchParams(
      serializeListParams(toListParams(query)),
    );
    const written = params.get("filter[createdAt][gte]");

    expect(written).toBe("2026-01-01T00:00:00.000Z");
    expect(written).not.toContain("GMT");
  });

  it("leaves an ordinary object alone", () => {
    // Every non-list request goes through the same serializer.
    expect(serializeListParams({ id: "abc", page: 2 })).toBe("id=abc&page=2");
  });
});
