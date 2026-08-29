import type { Page } from "@playwright/test";

import { expect, test } from "./support/fixtures";

import { waitForRows } from "./support/app";

/**
 * The record surfaces, and the form that must not lose its Save (`D10.4`).
 *
 * ADR-0044 gives every record the same URL and lets the config pick the shell;
 * `staff` declares a dialog and `users` a drawer, so both are walked. **The
 * `page` variant is not walked, because no resource declares it** — that gap
 * is recorded in `docs/plan/0010` §Already-recorded-as-deferred and is not
 * this step's to close.
 *
 * The long-form assertion is ADR-0048 §4's whole point: the surface scrolls
 * its *body*, not its frame, so the title and Save stay put. In a browser the
 * way to prove that is to make the form too tall for the viewport and look.
 */

const openFirstRecord = async (page: Page): Promise<void> => {
  await page
    .getByRole("button", { name: /^Row actions for/ })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
};

test("staff opens its record in a dialog, at the record's own URL", async ({
  app: page,
}) => {
  await page.goto("/staff");
  await waitForRows(page);
  await openFirstRecord(page);

  const dialog = page.getByRole("dialog");

  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/staff\/[0-9a-f-]{36}$/);
  // A record URL carries the record and nothing else (ADR-0044).
  await expect(page).not.toHaveURL(/\?/);

  /*
   * Closing returns to the list — and to *that* list, which is the history-
   * state carrier ADR-0044 built. Nothing was written, so nothing needs
   * cleaning up.
   */
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/staff$/);
});

test("users opens its record in a drawer, at the same shape of URL", async ({
  app: page,
}) => {
  await page.goto("/users");
  await waitForRows(page);
  await openFirstRecord(page);

  /*
   * The same assertion as staff's, against a different shell — which is the
   * property that lets `editSurface` be a one-line config change.
   */
  await expect(page.locator('[data-slot="sheet-content"]')).toBeVisible();
  await expect(page).toHaveURL(/\/users\/[0-9a-f-]{36}$/);

  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/users$/);
});

test("a form taller than the viewport keeps its title and its Save on screen", async ({
  app: page,
}) => {
  /*
   * Short on purpose. The staff form is four fields; at 1080px nothing
   * scrolls and the assertion would hold on a surface with the `D8`-era defect
   * still in it. Squeezing the viewport is what makes the body overflow, which
   * is the only state where "the frame does not scroll" means anything.
   */
  await page.setViewportSize({ width: 1280, height: 420 });

  await page.goto("/staff");
  await waitForRows(page);
  await openFirstRecord(page);

  const dialog = page.getByRole("dialog");
  const title = dialog.getByRole("heading").first();
  const save = dialog.getByRole("button", { name: "Save changes" });

  await expect(title).toBeVisible();
  await expect(save).toBeVisible();

  const titleBefore = await title.boundingBox();
  const saveBefore = await save.boundingBox();

  /*
   * Scroll the surface's body to the end. If the frame scrolls instead — the
   * defect ADR-0048 §4 was written against — the title leaves the top and Save
   * leaves the bottom, and an operator loses both exactly when the form is
   * long enough to need them.
   */
  const scrolled = await dialog.evaluate((element) => {
    const body = [...element.querySelectorAll("*")].find(
      (child) =>
        child.scrollHeight > child.clientHeight + 1 &&
        ["auto", "scroll"].includes(getComputedStyle(child).overflowY),
    );

    if (body === undefined) return 0;
    body.scrollTop = body.scrollHeight;

    return body.scrollTop;
  });

  expect(scrolled).toBeGreaterThan(0);

  await expect(title).toBeVisible();
  await expect(save).toBeVisible();
  /*
   * Within a few pixels, not equal, and the tolerance has a cause: the dialog
   * is centred, so when its body gains a scrollbar the frame's own height
   * settles and the whole surface re-centres by half of that. The invariant is
   * *did not travel with the content* — the content moved hundreds of pixels
   * and these moved single digits.
   */
  const drift = 8;

  expect(
    Math.abs(((await title.boundingBox())?.y ?? 0) - (titleBefore?.y ?? 0)),
  ).toBeLessThan(drift);
  expect(
    Math.abs(((await save.boundingBox())?.y ?? 0) - (saveBefore?.y ?? 0)),
  ).toBeLessThan(drift);
  expect(scrolled).toBeGreaterThan(drift * 4);

  await page.getByRole("button", { name: "Cancel" }).click();
});

/*
 * The viewport goes back **on every path**, because the context outlives these
 * tests (see `support/fixtures.ts`). A spec that shrank the window and then
 * failed would hand every later one a 420px screen and a cascade of failures
 * that look like layout bugs and are not.
 */
test.afterEach(async ({ app: page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
});
