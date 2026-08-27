import { describe, expect, it } from "vitest";

import { parseAdminSearch, stringifyAdminSearch } from "../search-params";

/**
 * The router's search adapter (ADR-0043, `D5.2`).
 *
 * The list-query syntax is `@repo/contracts`' and is tested there; the seam
 * through a real router is tested in `app/__tests__/search-serialization`.
 * What is left for this file is the part that belongs to neither — **the
 * delegation**: this pair is installed globally, on every route, so what it
 * does with a name the list language has never heard of is the property that
 * bounds its blast radius.
 */

describe("the router's search adapter", () => {
  it("writes list state in the canonical language", () => {
    expect(
      stringifyAdminSearch({
        offset: 20,
        limit: 50,
        sort: [{ field: "email", direction: "desc" }],
        filters: [{ field: "status", op: "eq", value: "active" }],
        q: "ann",
      }),
    ).toBe("?offset=20&limit=50&sort=-email&filter[status]=active&q=ann");
  });

  it("hands every other name to the router's own serializer", () => {
    // Byte for byte what TanStack Router would have written unaided.
    expect(stringifyAdminSearch({ redirect: "/staff" })).toBe(
      "?redirect=%2Fstaff",
    );
    expect(parseAdminSearch("?redirect=%2Fstaff")).toEqual({
      redirect: "/staff",
    });
  });

  it("joins the two halves when a route carries both", () => {
    const written = stringifyAdminSearch({
      sort: [{ field: "email", direction: "asc" }],
      redirect: "/staff",
    });

    expect(written).toBe("?sort=email&redirect=%2Fstaff");
    expect(parseAdminSearch(written)).toEqual({
      sort: [{ field: "email", direction: "asc" }],
      redirect: "/staff",
    });
  });

  it("says nothing when there is nothing to say", () => {
    expect(stringifyAdminSearch({})).toBe("");
    expect(parseAdminSearch("")).toEqual({});
  });

  it("does not let the default parser's JSON guess reach a list param", () => {
    /*
     * `defaultParseSearch` JSON-parses every value it can, which is right for
     * an arbitrary param and wrong for this language: `offset=20` would arrive
     * as the number 20 either way, but `sort=-email` is a string to it and a
     * `SortSpec[]` to the schema, and `filter[status]` is a key it would carry
     * through verbatim. The list names are taken away from it entirely.
     */
    expect(parseAdminSearch("?sort=-email&filter[status]=active")).toEqual({
      sort: [{ field: "email", direction: "desc" }],
      filters: [{ field: "status", op: "eq", value: "active" }],
    });
  });

  it("writes a list-named value of the wrong shape rather than dropping it", () => {
    /*
     * Unreachable through the router, which only ever serializes what
     * `validateSearch` validated — and "unreachable" is how an operator's
     * filter goes missing with nothing said. A value that fails its own guard
     * falls through to the default serializer, which is visible and
     * recoverable; omitting it would be neither.
     */
    expect(stringifyAdminSearch({ sort: "-email" })).toBe("?sort=-email");
    expect(stringifyAdminSearch({ offset: "20" })).toBe("?offset=%2220%22");
  });
});
