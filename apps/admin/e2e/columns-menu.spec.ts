import { expect, test } from "./support/fixtures";

import { waitForRows } from "./support/app";

/**
 * The column order goes back **whatever happened**, which is why this is an
 * `afterEach` and not the last line of the test.
 *
 * ADR-0045 made the order an account fact — a `PATCH /settings`, not a local
 * scribble — so a drag that failed halfway would leave the super admin's staff
 * grid rearranged on the server, for every later run and for the operator's
 * own browser. A cleanup that only runs on the happy path is not cleanup; it
 * is a promise kept exactly when it was not needed.
 */
const resetColumnOrder = async (page: import("@playwright/test").Page) => {
  const trigger = page.getByRole("button", { name: "Columns" });

  if (!(await trigger.isVisible().catch(() => false))) return;

  const reset = page.getByRole("button", { name: "Reset to defaults" });

  if (!(await reset.isVisible().catch(() => false))) {
    await trigger.click().catch(() => undefined);
  }

  if (await reset.isEnabled().catch(() => false)) {
    /*
     * **The write is awaited, not fired and forgotten** (`D11.11`).
     *
     * Reset is disabled when the grid is already on the config's order, so
     * reaching here means there *is* a stored arrangement and a
     * `PATCH /settings` follows (ADR-0045). The caller below reads the
     * headers straight afterwards to establish its baseline, and a read
     * taken before the reorder had settled would capture the order this
     * helper was called to undo — which is the one run the fix exists for.
     */
    const patched = page
      .waitForResponse(
        (response) =>
          response.url().endsWith("/admin/settings") &&
          response.request().method() === "PATCH",
        { timeout: 10_000 },
      )
      .catch(() => undefined);

    await reset.click().catch(() => undefined);
    await patched;
  }

  await page.keyboard.press("Escape").catch(() => undefined);
};

/**
 * The pointer drag `D10.3` could not certify (`D10.4`).
 *
 * The keyboard path is machine-checked in `@repo/grid`'s own suite and in the
 * admin's, against the real preference store. **What no jsdom test can do is
 * drag**: `closestCenter` compares the centres of laid-out boxes, and the unit
 * suites hand it stacked rectangles from a stub. This is the same gesture with
 * a real pointer over a real layout.
 *
 * **It writes, so it cleans up** (ADR-0052 §The browser tier's data rules).
 * Column order is an account preference since ADR-0045 — a `PATCH /settings`,
 * not a local scribble — so a spec that reordered and walked away would leave
 * the operator's account rearranged for the next run and for the next person
 * to open the app. Reset to defaults is part of the test, not tidiness.
 */

test("a column is dragged to a new position, and Reset puts it back", async ({
  app: page,
}) => {
  await page.goto("/staff");
  await waitForRows(page);

  const headers = () =>
    page
      .getByRole("columnheader")
      .allTextContents()
      .then((all) => all.map((text) => text.trim()).filter(Boolean));

  /*
   * **`before` is the config's order, put there rather than found
   * there** (`D11.11`).
   *
   * The last assertion below is that Reset returns the arrangement to
   * `before`, and Reset returns it to the **config** (ADR-0041) — so a
   * dev account carrying a stored order of its own made the two
   * different things and the case could not pass, whatever the drag
   * did. It is the same defect `grid-layout.spec.ts` carried in its row
   * height: an account fact read as if it were a property of the app.
   *
   * So the run starts where the assertion ends. `resetColumnOrder` is
   * the `afterEach`'s own helper and it is a no-op on an account that is
   * already on the defaults, which is what every run after the first
   * one is.
   */
  await resetColumnOrder(page);

  const before = await headers();

  await page.getByRole("button", { name: "Columns" }).click();

  const menu = page.getByRole("dialog");
  const rows = menu.locator('[data-slot="columns-menu-row"]');

  await expect(rows.first()).toBeVisible();

  const firstGrip = rows.nth(0).getByRole("button", { name: /^Reorder / });
  const thirdRow = rows.nth(2);

  const from = await firstGrip.boundingBox();
  const to = await thirdRow.boundingBox();

  if (from === null || to === null) throw new Error("no layout to drag over");

  /*
   * A real drag: press, cross the 8px activation distance, travel in steps so
   * the sortable's collision detection sees intermediate positions, drop.
   * `mouse.move` in one jump is the classic way to write a drag test that
   * passes against nothing.
   */
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    from.x + from.width / 2,
    from.y + from.height / 2 + 12,
    {
      steps: 4,
    },
  );
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 12,
  });
  await page.mouse.up();

  const afterDrag = await headers();

  /*
   * The invariant, not a fixed arrangement: the first column moved and the set
   * is unchanged. Naming the expected order would be a row-count assertion in
   * a different costume — the resource's columns are its own business and a
   * config change should not redden this.
   */
  expect(afterDrag).not.toEqual(before);
  expect([...afterDrag].sort()).toEqual([...before].sort());
  expect(afterDrag[0]).not.toBe(before[0]);

  /*
   * Reset as an assertion in its own right: ADR-0041 says Reset returns every
   * preference to the config, and `D10.3` had to keep that true for a gesture
   * the ADR never imagined. The `afterEach` below repeats it for the paths
   * that never reach here.
   */
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(async () => {
    expect(await headers()).toEqual(before);
  }).toPass();

  await page.keyboard.press("Escape");
});

test.afterEach(async ({ app: page }) => {
  await resetColumnOrder(page);
});
