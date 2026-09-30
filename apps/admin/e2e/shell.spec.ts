import { expect, test } from "./support/fixtures";

import { waitForRows } from "./support/app";

/**
 * The shell's bands, measured (`D11.3`, ADR-0054 §5).
 *
 * The package suite asserts that `AppShell` emits `h-14`, that the provider
 * carries `--sidebar-width: 240px`, and that the two new slots render only
 * when handed content. None of that proves a pixel: Tailwind has to have
 * generated the rule, the custom property has to reach both halves of the
 * drawer, and the page-header band has to be a band rather than a row the
 * grid's height budget quietly absorbed. This is the tier where a class
 * becomes a value.
 *
 * Rounded, for the reason `grid-layout.spec.ts` rounds: a browser reports
 * fractional box heights, and asserting an integer to the pixel would be
 * asserting a rounding mode.
 */

test("the header band is 56px and the drawer is 240px", async ({
  app: page,
}) => {
  await page.goto("/");
  /*
   * The shell, not the address bar. `goto` resolves on the document, and this
   * app boots `GET /auth/csrf` → `POST /auth/refresh` behind a loading gate
   * before any chrome renders (ADR-0033) — so an `evaluate` fired straight
   * after the navigation measures an empty page and reports zeroes, which is
   * exactly what the first run of this spec did.
   */
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const geometry = await page.evaluate(() => {
    const header = document.querySelector("header");
    /*
     * The fixed container, not the outer `group peer` div — that one is
     * `hidden md:block` and reports the *gap's* geometry as well. Both are
     * asserted below because the two are separate elements reading the same
     * custom property, and a width set in the wrong place moves one and
     * leaves the other reserving 16rem of empty column.
     */
    const drawer = document.querySelector('[data-slot="sidebar-container"]');
    const gap = document.querySelector('[data-slot="sidebar-gap"]');

    return {
      header: Math.round(header?.getBoundingClientRect().height ?? 0),
      drawer: Math.round(drawer?.getBoundingClientRect().width ?? 0),
      gap: Math.round(gap?.getBoundingClientRect().width ?? 0),
    };
  });

  expect(geometry.header).toBe(56);
  expect(geometry.drawer).toBe(240);
  expect(geometry.gap).toBe(240);
});

test("the page-header band carries the title and the route's description", async ({
  app: page,
}) => {
  await page.goto("/staff");
  await waitForRows(page);

  const band = page.locator('[data-slot="page-header"]');

  await expect(band.getByRole("heading", { level: 1 })).toHaveText("Staff");
  await expect(band.locator('[data-slot="page-description"]')).toHaveText(
    "The operators who can reach this panel.",
  );

  /*
   * A band above the page container, not a row inside it (ADR-0048 §2): the
   * grid's budget divides what is left *below* this element, and a
   * page-header that had slipped inside `page-container` would still render
   * identically and take its height from every grid.
   */
  const outside = await page.evaluate(() => {
    const container = document.querySelector('[data-slot="page-container"]');
    const header = document.querySelector('[data-slot="page-header"]');

    return header !== null && container !== null && !container.contains(header);
  });

  expect(outside).toBe(true);
});

test("the sidebar footer shows the build's version", async ({ app: page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const footer = page.locator('[data-slot="sidebar-footer"]');

  /*
   * The shape, not the value: the label is a `define` from the build's
   * `APP_VERSION` (ADR-0081, `D32.2`) — `dev` on a stack nobody labelled —
   * and nothing beside it, no separator and no commit (`D32.5`); the app's
   * own suite asserts the value. What only a browser can say is that the
   * substitution survived a production-shaped build rather than resolving to
   * the literal `undefined` — the failure mode a missing `define` produces,
   * and the one that looks fine in every jsdom assertion.
   */
  await expect(footer).toHaveText(/^\S+$/);
  await expect(footer).not.toHaveText(/·/);
  await expect(footer).not.toHaveText(/undefined/);
});
