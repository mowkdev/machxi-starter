import { MAX_LIMIT } from "@repo/contracts";
import { describe, expect, it } from "vitest";

import { offeredSizes } from "../grid-pager";

describe("offeredSizes", () => {
  it("offers the caller's sizes deduplicated and ascending", () => {
    expect(offeredSizes([50, 10, 10, 25], 25)).toEqual([10, 25, 50]);
  });

  it("always includes the current limit, because the URL can name any size", () => {
    // ?limit=37 is a legitimate hand-written URL (ADR-0034); a select whose
    // value is not among its options silently displays nothing.
    expect(offeredSizes([10, 20], 37)).toEqual([10, 20, 37]);
  });

  it("refuses sizes the contract would reject", () => {
    expect(offeredSizes([0, -5, 2.5, MAX_LIMIT + 1, 20], 20)).toEqual([20]);
  });

  it("keeps a size equal to the ceiling itself", () => {
    expect(offeredSizes([MAX_LIMIT], 20)).toEqual([20, MAX_LIMIT]);
  });
});
