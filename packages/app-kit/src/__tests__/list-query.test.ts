import { listQuerySchema } from "@repo/contracts";
import { describe, expect, it } from "vitest";

import { nestSearchParams, parseListSearch } from "../testing/list-query";

/**
 * Reading an ADR-0014 query string back the way the API reads it (`D20.10`,
 * ADR-0062 §1, ADR-0036).
 *
 * The claim this helper makes is not "it un-nests brackets" — it is that a
 * request the *API* would refuse is a request the *suite* refuses too, and
 * that only holds if what comes out of a flat `URLSearchParams` is what
 * Express's `qs` would have handed `validate()`. So the schema below is the
 * real `listQuerySchema` rather than a stub: `z.strictObject` means an
 * unexpected key or a mis-shaped `filter` fails the parse, which is precisely
 * the signal a handler is supposed to raise inside the test that renders a
 * screen.
 *
 * Shared by both apps since this step, so the negative cases matter more than
 * they did per app: a helper that quietly flattened `filter[x][gte]` into one
 * key would make every list handler in the repository accept a query the API
 * rejects, and no screen test could see it.
 */

const schema = listQuerySchema({
  sortable: ["createdAt", "email"],
  filterable: {
    status: { ops: ["eq", "in"] },
    createdAt: { ops: ["gte", "lte"] },
  },
  defaultSort: "-createdAt",
  searchable: true,
});

const parse = (search: string) =>
  parseListSearch(`http://api.test/admin/staff${search}`, schema);

describe("nestSearchParams", () => {
  it("rebuilds the nesting `qs` gives Express", () => {
    expect(
      nestSearchParams(
        new URLSearchParams(
          "offset=20&filter[createdAt][gte]=2026-01-01&filter[createdAt][lte]=2026-12-31",
        ),
      ),
    ).toEqual({
      offset: "20",
      filter: {
        createdAt: { gte: "2026-01-01", lte: "2026-12-31" },
      },
    });
  });

  it("nests the `filter[x]=v` shorthand one level, not two", () => {
    // The single-bracket form is its own path through `segmentsOf` — one `[`,
    // two segments, one level of nesting — and it is the commonest real input:
    // `@repo/contracts` documents a bare `filter[status]=active` as meaning
    // `eq`, and it is what the address bar shows. A helper that flattened it to
    // the key `"filter[status]"` would make the strict object refuse every
    // filtered list in both apps.
    expect(
      nestSearchParams(new URLSearchParams("filter[status]=active")),
    ).toEqual({ filter: { status: "active" } });
  });

  it("keeps a bracketless key flat", () => {
    expect(
      nestSearchParams(new URLSearchParams("q=ada&sort=-createdAt")),
    ).toEqual({ q: "ada", sort: "-createdAt" });
  });

  it("reads every value as a string, because a query string has nothing else", () => {
    // The coercion is the schema's job (`z.coerce.number()` on `offset`), and
    // a helper that guessed types here would disagree with the API on exactly
    // the inputs — "0", "false" — where guessing is wrong.
    expect(
      nestSearchParams(new URLSearchParams("count=false&limit=10")),
    ).toEqual({ count: "false", limit: "10" });
  });

  it("answers an empty object for a search with nothing in it", () => {
    expect(nestSearchParams(new URLSearchParams(""))).toEqual({});
  });
});

describe("parseListSearch", () => {
  it("parses a grid's URL through the endpoint's own schema", () => {
    expect(
      parse(
        "?offset=20&limit=10&sort=-createdAt&filter[status][eq]=active&q=ada",
      ),
    ).toEqual({
      offset: 20,
      limit: 10,
      sort: [{ field: "createdAt", direction: "desc" }],
      filters: [{ field: "status", op: "eq", value: "active" }],
      q: "ada",
      count: true,
    });
  });

  it("resolves the `filter[x]=v` shorthand to the `eq` the contract means", () => {
    expect(parse("?filter[status]=active")).toMatchObject({
      filters: [{ field: "status", op: "eq", value: "active" }],
    });
  });

  it("applies the endpoint's defaults to a bare list request", () => {
    expect(parse("")).toEqual({
      offset: 0,
      limit: 20,
      sort: [{ field: "createdAt", direction: "desc" }],
      filters: [],
      count: true,
    });
  });

  it("throws on a sort field the contract does not allow-list", () => {
    // The whole point of going through the real schema: this is the handler
    // failing in the test that renders the screen, rather than the suite
    // certifying a request the API would answer `400 VALIDATION_ERROR`.
    expect(() => parse("?sort=lastName")).toThrow();
  });

  it("throws on an operator the field does not allow", () => {
    expect(() => parse("?filter[status][gte]=active")).toThrow();
  });

  it("throws on a parameter outside the list contract", () => {
    expect(() => parse("?page=2")).toThrow();
  });
});
