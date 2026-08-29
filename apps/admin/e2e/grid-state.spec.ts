import { expect, test } from "./support/fixtures";

import { waitForRows } from "./support/app";

/**
 * What the grid says it is showing (`D10.4`).
 *
 * Sort, filter, and — since `D10.2` — a chip for a pressed hot filter, which
 * is the operator-visible half of ADR-0052 §Visible state. The component tier
 * asserts every one of these; what it cannot assert is that they are *visible*
 * at the same time, in the same bar, on a real screen.
 *
 * **Invariants, never counts.** The dev database drifts, so nothing here reads
 * how many rows came back. A sort is asserted as "the URL says so and the
 * header agrees", a filter as "the chip is there and clearing it removes it".
 */

test.beforeEach(async ({ app: page }) => {
  await page.goto("/staff");
  await waitForRows(page);
});

test("a header click sorts, and the URL says so in the API's own language", async ({
  app: page,
}) => {
  /*
   * `exact`, because the column's resize handle is *also* a button whose name
   * contains the header — "Resize Last name" (`D4.5`). A loose name matches
   * both and Playwright refuses to guess, which is the strict-mode violation
   * doing its job.
   */
  const sortByLastName = page.getByRole("button", {
    exact: true,
    name: "Last name",
  });

  await sortByLastName.click();

  /*
   * ADR-0043's headline property, in the address bar: the list state is
   * spelled the way the endpoint spells it, so what an operator copies out of
   * here is a valid query.
   */
  await expect(page).toHaveURL(/sort=lastName/);

  await sortByLastName.click();
  await expect(page).toHaveURL(/sort=-lastName/);
});

test("a pressed hot filter shows its chip, and the chip clears it", async ({
  app: page,
}) => {
  const bar = page.locator('[data-slot="grid-applied-filters"]');

  await expect(bar).toBeHidden();

  await page.getByRole("button", { name: "Active", exact: true }).click();

  /*
   * **The D10.2 reversal, on screen.** ADR-0039 suppressed this chip while the
   * button displayed the same filter; ADR-0052 retired that rule, so both are
   * visible at once and the bar is the whole inventory.
   */
  await expect(bar).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Active", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  const chip = bar.getByRole("button", { name: /^Remove filter/ });

  await expect(chip).toBeVisible();
  await chip.click();

  // And removing it releases the button — two affordances, one state.
  await expect(bar).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Active", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
});

test("the resize handle is visible at rest, before the pointer arrives", async ({
  app: page,
}) => {
  /*
   * **The `D10.2` affordance, and the reason this tier exists at all.** jsdom
   * can see the class; only a browser can say whether anything is painted. The
   * grip is an `::after` on the handle, so it is asked for by computed style
   * rather than by a locator — pseudo-elements have no DOM node.
   */
  const grip = await page
    .locator('[data-slot="grid-resize-handle"]')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element, "::after");

      return {
        content: style.content,
        background: style.backgroundColor,
        width: style.width,
        height: style.height,
      };
    });

  expect(grip.content).not.toBe("none");
  expect(grip.width).not.toBe("0px");
  expect(grip.height).not.toBe("0px");

  /*
   * Painted, not merely present: `bg-border` resolves to a real colour in both
   * themes, and a transparent one would be a handle that is "visible at rest"
   * only in the class list.
   */
  expect(grip.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(grip.background).not.toBe("transparent");
});
