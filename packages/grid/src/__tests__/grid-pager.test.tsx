import { MAX_LIMIT } from "@repo/contracts";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GridPager, offeredSizes } from "../grid-pager";
import { renderWithI18n } from "./support/render";

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

/**
 * The open-ended branch (ADR-0060 §2).
 *
 * `total: null` has been in `Page`'s type since D1.4 and in this component
 * since `D4`, and until `count=false` existed **no endpoint could produce
 * it** — so the branch was written from reasoning and never rendered. These
 * cases render it: they are what the done-when of `D14.5` asks for, and they
 * are why the flag is safe to hand a grid.
 */
describe("GridPager without a total", () => {
  const props = {
    offset: 0,
    limit: 20,
    total: null,
    rowCount: 20,
    lastOffset: null,
    onOffsetChange: () => undefined,
    onLimitChange: () => undefined,
  };

  it("shows a range rather than a count, and no NaN", () => {
    renderWithI18n(<GridPager {...props} offset={20} />);

    const range = screen.getByText("21–40");

    expect(range).toBeInTheDocument();
    expect(range.textContent).not.toContain("NaN");
    expect(screen.queryByText(/of/)).not.toBeInTheDocument();
  });

  it("offers no jump to a last page there is no way to know", () => {
    renderWithI18n(<GridPager {...props} />);

    expect(screen.getByRole("button", { name: "Last page" })).toBeDisabled();
  });

  it("treats a full page as the only evidence that more exists", () => {
    const { unmount } = renderWithI18n(<GridPager {...props} />);

    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();

    unmount();
    renderWithI18n(<GridPager {...props} rowCount={7} />);

    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("still says so when the page is empty", () => {
    renderWithI18n(<GridPager {...props} rowCount={0} />);

    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("counts and offers the last page when the endpoint did count", () => {
    renderWithI18n(
      <GridPager {...props} total={143} rowCount={20} lastOffset={140} />,
    );

    expect(screen.getByText("1–20 of 143")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Last page" })).toBeEnabled();
  });
});
