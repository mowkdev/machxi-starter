import type { Filter } from "@repo/contracts";
import { describe, expect, it } from "vitest";

/*
 * **The fixture's labels are `grid:` keys since `D9.4`**, where `demo:` ones
 * stood before. Nothing here asserts on copy — they are column headers in a
 * config this file builds to exercise `hot-filters` — but a `TranslationKey`
 * inside this package resolves over the namespace the package *declares*
 * (ADR-0046 §13), and `demo:` is the admin test fixture's. The swap is what
 * makes the type check mean something here rather than being cast away.
 */

import type { HotFilterConfig } from "@repo/resource";

import {
  displayedByHotFilters,
  hotFilterSelection,
  isPresenceOn,
  toggledHotFilter,
  toggledPresence,
} from "../hot-filters";

/**
 * The hot filters' round trip (ADR-0039, `D4.4`).
 *
 * Press → filters → URL → pressed. Every function here is one leg of that
 * loop, and the loop is the reason hot filters are a third *writer* of the list
 * state rather than a second mechanism beside it: what a button writes is what
 * the same field's header dialog reads, so the two cannot disagree.
 */

const STATUS: Extract<HotFilterConfig, { kind: "enum" }> = {
  kind: "enum",
  field: "status",
  label: "grid:filter.title",
  op: "eq",
  options: ["active", "disabled"],
};

const TAGS: Extract<HotFilterConfig, { kind: "enum" }> = {
  kind: "enum",
  field: "tags",
  label: "grid:filter.any",
  op: "in",
  options: ["alpha", "beta"],
};

const ARCHIVED: Extract<HotFilterConfig, { kind: "presence" }> = {
  kind: "presence",
  field: "archivedAt",
  label: "grid:filter.trigger",
  op: "null",
  value: false,
};

describe("what a group shows as pressed", () => {
  it("reads the URL, and nothing else", () => {
    expect(
      hotFilterSelection(
        [{ field: "status", op: "eq", value: "disabled" }],
        STATUS,
      ),
    ).toEqual(["disabled"]);
    expect(hotFilterSelection([], STATUS)).toEqual([]);
  });

  it("ignores an entry written with the other operator", () => {
    // An `eq` group cannot represent an `in`; claiming otherwise would press a
    // button for a filter it could not have produced.
    expect(
      hotFilterSelection(
        [{ field: "status", op: "in", value: ["active"] }],
        STATUS,
      ),
    ).toEqual([]);
  });

  it("shows nothing rather than part of a value it cannot represent", () => {
    /*
     * All-or-nothing, and this is the suppression rule's other half. A deep
     * link carrying an option the group does not declare must not be *partly*
     * displayed: pressed buttons would claim the filter is visible here while
     * the unrepresentable part of it stayed invisible. Showing nothing pressed
     * hands the whole entry to the chips bar, which can render anything.
     */
    expect(
      hotFilterSelection(
        [{ field: "status", op: "eq", value: "archived" }],
        STATUS,
      ),
    ).toEqual([]);
    expect(
      hotFilterSelection(
        [{ field: "tags", op: "in", value: ["alpha", "gamma"] }],
        TAGS,
      ),
    ).toEqual([]);
  });

  it("reads a presence toggle by its declared value", () => {
    expect(
      isPresenceOn(
        [{ field: "archivedAt", op: "null", value: false }],
        ARCHIVED,
      ),
    ).toBe(true);
    // The opposite scope is not this toggle pressed; it is a different request.
    expect(
      isPresenceOn(
        [{ field: "archivedAt", op: "null", value: true }],
        ARCHIVED,
      ),
    ).toBe(false);
  });
});

describe("what a press writes", () => {
  it("releases an `eq` option by pressing it again", () => {
    // The implicit "All": a single-select stance is cleared by the same button
    // that set it, which is why the group needs no extra control.
    expect(toggledHotFilter(STATUS, [], "active")).toEqual([
      { field: "status", op: "eq", value: "active" },
    ]);
    expect(toggledHotFilter(STATUS, ["active"], "active")).toEqual([]);
    expect(toggledHotFilter(STATUS, ["active"], "disabled")).toEqual([
      { field: "status", op: "eq", value: "disabled" },
    ]);
  });

  it("accumulates an `in` group into one filter, and empties to none", () => {
    expect(toggledHotFilter(TAGS, ["alpha"], "beta")).toEqual([
      { field: "tags", op: "in", value: ["alpha", "beta"] },
    ]);
    expect(toggledHotFilter(TAGS, ["alpha", "beta"], "beta")).toEqual([
      { field: "tags", op: "in", value: ["alpha"] },
    ]);
    expect(toggledHotFilter(TAGS, ["alpha"], "alpha")).toEqual([]);
  });

  it("writes a presence filter on, and nothing off", () => {
    // Off writes *nothing* rather than the opposite: "no opinion" and "only the
    // live ones" are the same request to an endpoint whose default scope
    // already hides them (ADR-0014's step-9 amendment).
    expect(toggledPresence(ARCHIVED, false)).toEqual([
      { field: "archivedAt", op: "null", value: false },
    ]);
    expect(toggledPresence(ARCHIVED, true)).toEqual([]);
  });
});

describe("the suppression rule", () => {
  const displayed = (filter: Filter): boolean =>
    displayedByHotFilters([filter], [STATUS, ARCHIVED]).has(filter);

  it("suppresses exactly what a button could have produced", () => {
    expect(displayed({ field: "status", op: "eq", value: "active" })).toBe(
      true,
    );
    expect(displayed({ field: "archivedAt", op: "null", value: false })).toBe(
      true,
    );
  });

  it("leaves the chip standing for anything the groups cannot represent", () => {
    /*
     * The invariant is "every applied filter is visible and removable in
     * exactly one place" — so a value outside the options, an operator no group
     * writes, and a field none of them own all keep their chips.
     */
    expect(displayed({ field: "status", op: "eq", value: "archived" })).toBe(
      false,
    );
    expect(displayed({ field: "status", op: "in", value: ["active"] })).toBe(
      false,
    );
    expect(displayed({ field: "archivedAt", op: "null", value: true })).toBe(
      false,
    );
    expect(displayed({ field: "ownerId", op: "eq", value: "u-9" })).toBe(false);
  });

  it("suppresses the entry a group read, not every entry that resembles it", () => {
    /*
     * The reason this returns a set of entries rather than answering about one.
     * `hotFilterSelection` reads the *first* `field:op` entry, so a URL holding
     * two presses "Active" — and a predicate asked about each filter in
     * isolation would have said yes to both, leaving the second invisible and
     * unremovable. That is the "visible and removable in exactly one place"
     * invariant failing inside the code that exists to keep it.
     */
    const first = { field: "status", op: "eq", value: "active" } as const;
    const second = { field: "status", op: "eq", value: "disabled" } as const;

    const set = displayedByHotFilters([first, second], [STATUS]);

    expect(set.has(first)).toBe(true);
    expect(set.has(second)).toBe(false);
  });
});
