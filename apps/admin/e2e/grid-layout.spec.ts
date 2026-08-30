import { expect, test } from "./support/fixtures";

import type { Page } from "@playwright/test";

import { GRIDS, grid, pager, scrollPane, waitForRows } from "./support/app";

/**
 * ADR-0037's height budget, in a browser (`D10.4`).
 *
 * **This is the file the whole tier was built for.** Every layout defect D4
 * shipped was caught by an operator's eye and none by a test, because jsdom
 * lays nothing out: sticky positioning, scroll containment and a page-level
 * scrollbar are all invisible to it. The component tier asserts the class
 * strings that produce this; only here can the result be checked.
 *
 * Asserted for **both** grids, because the budget is a chain — every wrapper
 * from the page container down carries `flex flex-col flex-1 min-h-0` — and a
 * chain broken on one screen and not the other is the exact failure mode
 * ADR-0037 describes.
 *
 * **Nothing here requires rows to exist, and one case skips itself when they
 * do not.** ADR-0052's data rule is that the suite must be green over any
 * database the seeds have touched — and a *freshly* seeded one has three staff
 * and three users, which against the pane's `min-h-64` floor never overflow at
 * any viewport. A scroll assertion on a pane that cannot scroll is a row-count
 * assertion wearing a costume: it would pass on this developer's accumulated
 * rows and fail on a clean seed, which is precisely backwards.
 */

/** Whether the pane has anything to scroll — the honest precondition. */
const overflows = (page: Page): Promise<boolean> =>
  scrollPane(page).evaluate(
    (element) => element.scrollHeight > element.clientHeight + 1,
  );

for (const { name, path } of GRIDS) {
  test(`${name}: the rows scroll under a static header and pager`, async ({
    app: page,
  }) => {
    await page.goto(path);
    await waitForRows(page);

    const pane = scrollPane(page);
    const header = grid(page).locator("thead").first();

    await expect(pane).toBeVisible();
    await expect(pager(page)).toBeVisible();

    /*
     * The one skip in the suite, and it is the data rule rather than a
     * weakness: with fewer rows than the pane is tall there is no scroll to
     * make the header static *against*, and asserting one would be asserting
     * how much data this machine happens to hold.
     */
    test.skip(
      !(await overflows(page)),
      "this database has fewer rows than the pane is tall — nothing to scroll",
    );

    const headerBefore = await header.boundingBox();
    const pagerBefore = await pager(page).boundingBox();

    /*
     * Scroll the pane rather than the window. If the budget is broken the pane
     * has nothing to scroll and the document moves instead — which is what the
     * page-level assertion below then catches.
     */
    const scrolled = await pane.evaluate((element) => {
      element.scrollTop = element.scrollHeight;

      return element.scrollTop;
    });

    /*
     * The rows really moved, and by a lot. Without this the two assertions
     * below are vacuously true on any viewport tall enough to show the whole
     * page — which is most of them, on a seeded dev database.
     */
    expect(scrolled).toBeGreaterThan(50);

    const headerAfter = await header.boundingBox();
    const pagerAfter = await pager(page).boundingBox();

    /*
     * "Static" is *did not travel with the rows*, not "moved by exactly zero".
     * A sticky `thead` snaps to the pane's top edge on first scroll, which is
     * about two pixels above where it sits at rest under `border-separate` —
     * so the tolerance is a few pixels against a scroll of hundreds. A header
     * that came unstuck moves the whole distance and cannot pass this.
     */
    expect(
      Math.abs((headerAfter?.y ?? 0) - (headerBefore?.y ?? 0)),
    ).toBeLessThan(8);
    expect(Math.abs((pagerAfter?.y ?? 0) - (pagerBefore?.y ?? 0))).toBeLessThan(
      2,
    );
  });

  test(`${name}: the chrome measures what Instrument says it measures`, async ({
    app: page,
  }) => {
    await page.goto(path);
    await waitForRows(page);

    /*
     * The values, in the only place they are values rather than class strings
     * (ADR-0054 §4, `D11.2`). The package suites assert that the component
     * emits `h-[34px]` and `h-[44px]`; nothing there can prove Tailwind
     * generated the rule, that the primitive's own `h-10` and `p-2` lost the
     * merge, or that the header band did not grow a pixel from a border.
     * Here they are measured.
     *
     * Rounded, because a browser reports fractional box heights: the border on
     * the header's cells lands the rule at 34.x, and asserting an integer to
     * the pixel would be asserting a rounding mode.
     */
    const heights = await page.evaluate(() => {
      const headerRow = document.querySelector("thead tr");
      const bodyRow = document.querySelector("tbody tr");

      return {
        header: Math.round(headerRow?.getBoundingClientRect().height ?? 0),
        row: Math.round(bodyRow?.getBoundingClientRect().height ?? 0),
      };
    });

    expect(heights.header).toBe(34);
    // Comfortable, the only density shipped until `D11.6` adds Compact at 34.
    expect(heights.row).toBe(44);

    /*
     * **The pane's own border box is gone** — precisely that, and not yet
     * "edge to edge inside the inset". `@repo/grid` drew itself a
     * `rounded-md border bg-card` frame, and that is what §4 replaces with
     * band rules; the *page's* `Card` around it is `D11.3`'s to retire when
     * the page container grows its full-bleed variant. Asserted as computed
     * style rather than as an absent class, because a width of zero is the
     * fact and a class list is only how it was reached.
     */
    const frame = await scrollPane(page).evaluate((element) => {
      const style = getComputedStyle(element);

      return {
        borderTopWidth: style.borderTopWidth,
        borderRadius: style.borderTopLeftRadius,
      };
    });

    expect(frame.borderTopWidth).toBe("0px");
    expect(frame.borderRadius).toBe("0px");
  });

  test(`${name}: the page itself never scrolls sideways`, async ({
    app: page,
  }) => {
    await page.goto(path);
    await waitForRows(page);

    /*
     * `min-w-0` on the inset and the page container is what keeps a wide table
     * from flooring the layout at its own min-content width (ADR-0037 §Fix the
     * flex floor). The symptom is a horizontal scrollbar on the *document*,
     * which is one comparison to make and impossible to see in jsdom.
     */
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });

  test(`${name}: the rows are the only thing that scrolls`, async ({
    app: page,
  }) => {
    await page.goto(path);
    await waitForRows(page);

    /*
     * One scroll container, which is the property that makes the sticky header
     * and the static pager possible at all. Any *other* vertically scrollable
     * element inside the shell is a second budget, and the two would fight.
     */
    const scrollers = await page.evaluate(() => {
      const inset = document.querySelector('[data-slot="sidebar-inset"]');

      if (inset === null) return ["no inset"];

      return [...inset.querySelectorAll("*")]
        .filter((element) => {
          const style = getComputedStyle(element);
          const scrolls =
            style.overflowY === "auto" || style.overflowY === "scroll";

          return scrolls && element.scrollHeight > element.clientHeight + 1;
        })
        .map((element) => element.getAttribute("data-slot") ?? element.tagName);
    });

    /*
     * "No *second* scroller", not "exactly one": on a database with few rows
     * the grid's own pane does not overflow and reports nothing, and the
     * property under test — one budget, not two fighting — holds either way.
     */
    expect(scrollers.filter((slot) => slot !== "grid-scroll")).toEqual([]);
  });
}
