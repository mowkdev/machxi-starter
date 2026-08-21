import { describe, expect, it } from "vitest";

import { listQuerySearchSchema } from "../list-query.js";
import {
  isListSearchState,
  parseListSearch,
  stringifyListSearch,
} from "../list-search.js";

import type { ListSearchState } from "../list-search.js";

/**
 * The list-query codec (ADR-0043), tested as **one property** rather than as
 * two functions that look right separately.
 *
 * The lesson being spent here is `D4.7`'s: a search term could not be cleared
 * for an entire deliverable because every pure function was correct and the
 * defect lived in the seam between two of them. A writer and a reader checked
 * apart are two correct pieces; what a caller depends on is the round trip, so
 * that is what is asserted, over a table of states rather than one example.
 *
 * `listQuerySearchSchema` is inside the round trip on purpose. The writer emits
 * nothing for an empty `sort` or `filters` — this language has no `sort=` — so
 * the schema's own defaults are what fill them back in, which is exactly how a
 * router will use the pair.
 */

const roundTrip = (state: ListSearchState) =>
  listQuerySearchSchema.parse(parseListSearch(stringifyListSearch(state)));

const base = { offset: 0, limit: 20, sort: [], filters: [] } as const;

const cases: ReadonlyArray<readonly [string, ListSearchState]> = [
  ["the empty state", base],
  ["pagination away from the defaults", { ...base, offset: 40, limit: 50 }],
  [
    "a multi-field sort in both directions",
    {
      ...base,
      sort: [
        { field: "createdAt", direction: "desc" },
        { field: "email", direction: "asc" },
      ],
    },
  ],
  [
    "the bare eq shorthand",
    { ...base, filters: [{ field: "status", op: "eq", value: "active" }] },
  ],
  [
    "an in list",
    {
      ...base,
      filters: [{ field: "roles", op: "in", value: ["admin", "manager"] }],
    },
  ],
  [
    "every ordered comparison",
    {
      ...base,
      filters: [
        { field: "createdAt", op: "gte", value: "2026-01-01" },
        { field: "createdAt", op: "lt", value: "2026-02-01" },
        { field: "age", op: "gt", value: "18" },
        { field: "age", op: "lte", value: "65" },
      ],
    },
  ],
  [
    "a like pattern with characters that must survive escaping",
    {
      ...base,
      filters: [{ field: "email", op: "like", value: "%100%_acme.com%" }],
    },
  ],
  [
    "a presence filter, whose value is a boolean and not a string",
    { ...base, filters: [{ field: "deletedAt", op: "null", value: false }] },
  ],
  ["a search term", { ...base, q: "ada lovelace" }],
  [
    "everything at once",
    {
      offset: 60,
      limit: 100,
      sort: [{ field: "email", direction: "desc" }],
      filters: [
        { field: "status", op: "eq", value: "active" },
        { field: "roles", op: "in", value: ["admin"] },
        { field: "deletedAt", op: "null", value: true },
      ],
      q: "ann",
    },
  ],
];

describe("list search codec", () => {
  describe("round trip", () => {
    it.each(cases)("survives %s", (_name, state) => {
      expect(roundTrip(state)).toEqual({
        ...state,
        ...(state.q === undefined ? {} : { q: state.q }),
      });
    });
  });

  describe("the canonical string", () => {
    it("writes the ADR-0014 shapes, with brackets spelled literally", () => {
      const written = stringifyListSearch({
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

      /*
       * Asserted as one string rather than parameter by parameter, because the
       * readability of the whole is the decision. `%5B` here would be a passing
       * test of a URL nobody can read.
       */
      expect(written).toBe(
        "offset=20&limit=50&sort=-createdAt%2Cemail&filter[status]=active" +
          "&filter[roles][in]=admin%2Cmanager&filter[createdAt][gte]=2026-01-01&q=ada",
      );
    });

    it("is still a query string a standard parser reads", () => {
      // The literal brackets are a spelling, not a dialect.
      const params = new URLSearchParams(
        stringifyListSearch({
          ...base,
          filters: [{ field: "status", op: "eq", value: "active" }],
        }),
      );

      expect(params.get("filter[status]")).toBe("active");
    });

    it("escapes everything except the brackets", () => {
      /*
       * The `%` of a `like` pattern must stay `%25`. ADR-0039 escapes an
       * operator's literal `100%` on the client precisely so the filter means
       * the four characters; unescaping it here would turn their filter into
       * "match everything" one layer further down.
       */
      const written = stringifyListSearch({
        ...base,
        filters: [{ field: "email", op: "like", value: "%100%" }],
      });

      expect(written).toContain("filter[email][like]=%25100%25");
      expect(parseListSearch(written)["filters"]).toEqual([
        { field: "email", op: "like", value: "%100%" },
      ]);
    });

    it("writes the keys it is given and no others", () => {
      /*
       * What a router hands the writer after `stripSearchParams` has removed
       * everything equal to its default: a grid on page one at the default
       * size with one sort applied is one key, and writing `offset=0&limit=20`
       * around it would put back exactly what that middleware took out.
       */
      expect(
        stringifyListSearch({ sort: [{ field: "email", direction: "desc" }] }),
      ).toBe("sort=-email");
      expect(stringifyListSearch({})).toBe("");
      expect(stringifyListSearch({ offset: 40 })).toBe("offset=40");
    });

    it("omits what this language cannot say", () => {
      const written = stringifyListSearch({ ...base, q: "" });

      // No `sort=`, no `filter`, and no `q=` — which the schema would reject.
      expect(written).toBe("offset=0&limit=20");
    });

    it("writes a Date as an ISO instant, not a JS date string", () => {
      const written = stringifyListSearch({
        ...base,
        filters: [
          {
            field: "createdAt",
            op: "gte",
            value: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
      });

      expect(written).toContain("filter[createdAt][gte]=2026-01-01T00");
      expect(written).not.toContain("GMT");
    });
  });

  describe("the reader", () => {
    it("reads a hand-typed URL with percent-encoded brackets", () => {
      // `URLSearchParams` decodes the key, so both spellings arrive the same.
      expect(parseListSearch("filter%5Bstatus%5D=active")["filters"]).toEqual([
        { field: "status", op: "eq", value: "active" },
      ]);
    });

    it("ignores parameters this language does not define", () => {
      // A router's search is one object across every route; `redirect` is not
      // this reader's business, and silently eating it would be worse.
      expect(parseListSearch("offset=20&redirect=%2Fstaff")).toEqual({
        offset: 20,
      });
    });

    it("leaves an absent parameter absent, so the schema's defaults apply", () => {
      expect(parseListSearch("q=ada")).toEqual({ q: "ada" });
      expect(listQuerySearchSchema.parse(parseListSearch("q=ada"))).toEqual({
        ...base,
        q: "ada",
      });
    });

    it("passes a malformed value through for the schema to reject", () => {
      /*
       * Shape recovery is this function's job; legality is the schema's. An
       * `offset` of `NaN` would be a router paging into nowhere with nothing
       * said, so the string survives and earns a VALIDATION_ERROR that names
       * the parameter.
       */
      expect(parseListSearch("offset=x")).toEqual({ offset: "x" });
      expect(listQuerySearchSchema.safeParse({ offset: "x" }).success).toBe(
        false,
      );
    });

    it("does not invent a boolean for a malformed presence filter", () => {
      expect(parseListSearch("filter[deletedAt][null]=yes")["filters"]).toEqual(
        [{ field: "deletedAt", op: "null", value: "yes" }],
      );
    });
  });

  describe("isListSearchState", () => {
    it("recognises a parsed list query and nothing else", () => {
      expect(isListSearchState({ ...base })).toBe(true);
      expect(isListSearchState({ id: "abc", page: 2 })).toBe(false);
      // Half a list query is not a list query.
      expect(isListSearchState({ offset: 0, limit: 20, sort: [] })).toBe(false);
    });
  });
});
