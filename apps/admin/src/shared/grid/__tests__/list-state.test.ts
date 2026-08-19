import { listQuerySearchSchema, listStaffQuery } from "@repo/contracts";
import { describe, expect, it } from "vitest";

import { demoResourceConfig } from "@/test/fixtures/demo-resource";

import {
  filterableColumns,
  fromColumnFiltersState,
  toColumnFilterValue,
  toColumnFiltersState,
  toListFilters,
} from "../column-filters";
import {
  containsPattern,
  fromSortingState,
  isStranded,
  lastPageOffset,
  toSortingState,
  withFilters,
  withLimit,
  withOffset,
  withSearch,
  withSort,
} from "../list-state";

/**
 * The pure seam between the URL and the engine (ADR-0034/0035).
 *
 * Everything here is a function of data, so it is tested as one. The property
 * worth defending is that the two directions agree: a filter written into the
 * URL has to come back as the control state that wrote it, or an operator
 * watches their filter vanish on the next render.
 */

const base = listQuerySearchSchema.parse({});
const filterable = filterableColumns(
  Object.entries(demoResourceConfig.columns),
);

describe("sort state", () => {
  it("round-trips through the engine's shape", () => {
    const sort = [
      { field: "createdAt", direction: "desc" },
      { field: "email", direction: "asc" },
    ] as const;

    expect(toSortingState(sort)).toEqual([
      { id: "createdAt", desc: true },
      { id: "email", desc: false },
    ]);
    expect(fromSortingState(toSortingState(sort))).toEqual(sort);
  });
});

describe("list-state transitions", () => {
  it("returns to the first page when what is listed changes", () => {
    /*
     * Sorting from page 4 and staying on page 4 is how an operator reaches an
     * empty grid and concludes there are no results — the stranded page,
     * arrived at deliberately rather than by a deletion.
     */
    const onPage4 = { ...base, offset: 60 };

    expect(
      withSort(onPage4, [{ field: "email", direction: "asc" }]).offset,
    ).toBe(0);
    expect(withFilters(onPage4, []).offset).toBe(0);
    expect(withSearch(onPage4, "ada").offset).toBe(0);
  });

  it("keeps the operator near their place when the page size changes", () => {
    expect(withLimit({ ...base, offset: 60, limit: 20 }, 50).offset).toBe(50);
  });

  it("drops an empty search rather than sending `q=`", () => {
    // `listQuerySchema` rejects an empty `q` as too short, so "cleared" has to
    // mean absent.
    expect(withSearch({ ...base, q: "ada" }, "")).not.toHaveProperty("q");
    expect(withSearch(base, "ada").q).toBe("ada");
  });

  it("never writes a negative offset", () => {
    expect(withOffset(base, -20).offset).toBe(0);
  });
});

describe("the stranded page", () => {
  it("is the empty page of a dataset that still has rows", () => {
    expect(isStranded({ items: [], total: 45 }, 60)).toBe(true);
    expect(isStranded({ items: [], total: 0 }, 0)).toBe(false);
    expect(isStranded({ items: [{}], total: 45 }, 40)).toBe(false);
    // An endpoint that opted out of counting cannot say where the end is.
    expect(isStranded({ items: [], total: null }, 60)).toBe(false);
  });

  it("lands on the last page that holds a row", () => {
    expect(lastPageOffset(45, 20)).toBe(40);
    expect(lastPageOffset(40, 20)).toBe(20);
    expect(lastPageOffset(0, 20)).toBe(0);
  });
});

describe("containsPattern", () => {
  it("escapes what the operator typed before wrapping it", () => {
    /*
     * ADR-0014 does not escape `like` filters because a client writes those
     * patterns on purpose. A UI writing one *on the operator's behalf* is the
     * opposite case: `100%` means four characters, and unescaped it would mean
     * "match everything".
     */
    expect(containsPattern("100%")).toBe("%100\\%%");
    expect(containsPattern("a_b")).toBe("%a\\_b%");
    expect(containsPattern("back\\slash")).toBe("%back\\\\slash%");
  });
});

describe("column filters", () => {
  it("writes an escaped containment filter and reads back the typed term", () => {
    const filters = toListFilters(
      "name",
      demoResourceConfig.columns.name.filter,
      {
        kind: "text",
        term: "100%",
      },
    );

    expect(filters).toEqual([{ field: "name", op: "like", value: "%100\\%%" }]);

    // The round trip is the point: a pasted link renders the control the same
    // way the session that produced it did.
    expect(
      toColumnFilterValue(
        filters,
        "name",
        demoResourceConfig.columns.name.filter,
      ),
    ).toEqual({ kind: "text", term: "100%" });
  });

  it("writes an enum filter with the operator its config declares", () => {
    expect(
      toListFilters("status", demoResourceConfig.columns.status.filter, {
        kind: "enum",
        values: ["active"],
      }),
    ).toEqual([{ field: "status", op: "eq", value: "active" }]);
  });

  it("writes a range as two filters, the upper bound at the end of the day", () => {
    const filters = toListFilters(
      "createdAt",
      demoResourceConfig.columns.createdAt.filter,
      { kind: "dateRange", from: "2026-01-01", to: "2026-01-31" },
    );

    expect(filters).toHaveLength(2);
    expect(filters[0]).toEqual({
      field: "createdAt",
      op: "gte",
      value: new Date("2026-01-01T00:00:00.000Z"),
    });
    // "up to the 31st" means the 31st included, not everything before it began.
    expect(filters[1]).toEqual({
      field: "createdAt",
      op: "lte",
      value: new Date("2026-01-31T23:59:59.999Z"),
    });
  });

  it("says nothing when a control is empty", () => {
    const empty = [
      toListFilters("name", demoResourceConfig.columns.name.filter, {
        kind: "text",
        term: "   ",
      }),
      toListFilters("createdAt", demoResourceConfig.columns.createdAt.filter, {
        kind: "dateRange",
        from: "",
        to: "",
      }),
      toListFilters(
        "archivedAt",
        demoResourceConfig.columns.archivedAt.filter,
        { kind: "presence", on: false },
      ),
    ];

    expect(empty).toEqual([[], [], []]);
  });

  it("round-trips the whole state through the engine's shape", () => {
    const filters = [
      { field: "name", op: "like", value: "%ada%" },
      { field: "status", op: "eq", value: "active" },
      { field: "archivedAt", op: "null", value: false },
    ] as const;

    const state = toColumnFiltersState(filters, filterable);

    expect(fromColumnFiltersState(state, filterable)).toEqual(
      expect.arrayContaining([...filters]),
    );
  });
});

describe("what the grid writes is what the API accepts", () => {
  it("survives the route's own search schema", () => {
    /*
     * The grid navigates with these objects and TanStack Router round-trips
     * them back through `validateSearch` (ADR-0034, amended D3.5). A state the
     * schema rejects would be a silent reset to page one on the first click, so
     * it is asserted rather than assumed.
     */
    const next = withFilters(
      withSort({ ...base, offset: 40 }, [
        { field: "createdAt", direction: "desc" },
      ]),
      [{ field: "status", op: "eq", value: "active" }],
    );

    expect(listQuerySearchSchema.safeParse(next).success).toBe(true);
  });

  it("serializes to a wire form a real endpoint's schema parses", () => {
    // The other half of the seam: the parsed state goes out as ADR-0014's
    // bracket syntax, and `listStaffQuery` is what will read it.
    expect(
      listStaffQuery.safeParse({
        offset: "40",
        limit: "20",
        sort: "-createdAt",
        filter: { status: "active" },
      }).success,
    ).toBe(true);
  });
});
