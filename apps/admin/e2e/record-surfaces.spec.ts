import type { Locator, Page } from "@playwright/test";

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

/**
 * What ADR-0054 §7's title rung really is: the number it draws, and the most
 * the band may grow to for the copy it holds (`D18.11`).
 *
 * A pair rather than an exact value, because the band is a `min-h` and the
 * sentence inside it is copy — which changes, and did at `D18.10`. 73 is the
 * measured height of a two-line description in both shells; anything above it
 * is a band that has stopped being this rung rather than a sentence that has
 * grown by a line.
 */
const TITLE_BAND = { min: 60, max: 73 } as const;

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

/**
 * The band anatomy, measured (`D11.5`, ADR-0054 §7).
 *
 * The package suites assert that the container emits `min-h-15`, `p-6` and
 * `min-h-16`; nothing there can prove Tailwind generated the rules, that
 * `SheetHeader`'s own `p-4` and `DialogContent`'s `p-6` lost the merge, or
 * that a band holding a real record's title still measures 60. This is the one
 * tier where a class string becomes a value.
 *
 * Both shells, because the reference draws them as siblings and a band stack
 * that agreed on one screen and not the other is precisely the drift the
 * shared container exists to prevent — the same reason `grid-layout.spec.ts`
 * walks both grids.
 */
const SURFACES = [
  { name: "staff", path: "/staff", frame: '[role="dialog"]' },
  { name: "users", path: "/users", frame: '[data-slot="sheet-content"]' },
] as const;

/**
 * Wait out the open animation before measuring, and **never skip this**.
 *
 * Both surfaces animate in — the dialog `zoom-in-95`, the drawer
 * `slide-in-from-right` — and `toBeVisible()` resolves the moment the element
 * is painted, which is the *first* frame of that. A box read there is the
 * transformed box: the first run of this file measured the title bar at 59 and
 * the dialog at 591, both ~98.5% of the truth, which looks exactly like a
 * one-pixel styling bug and is not one. Every animation on the subtree, not
 * just the frame's, because the bands' own boxes are what the assertions read.
 */
const settled = async (surface: Locator): Promise<void> => {
  await surface.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        // A cancelled animation rejects; an interrupted open is not a failure.
        .map(async (animation) => animation.finished.catch(() => undefined)),
    );
  });
};

for (const { name, path, frame } of SURFACES) {
  test(`${name}: the record surface is a stack of bands`, async ({
    app: page,
  }) => {
    await page.goto(path);
    await waitForRows(page);
    await openFirstRecord(page);

    const surface = page.locator(frame).first();

    await expect(surface).toBeVisible();
    await settled(surface);

    const bands = await surface.evaluate((element) => {
      const box = (selector: string): number =>
        Math.round(
          element.querySelector(selector)?.getBoundingClientRect().height ?? 0,
        );

      const footer = element.querySelector<HTMLElement>(
        '[data-slot="surface-footer"]',
      );

      /*
       * `--muted` read back through a **probe element** rather than off
       * `:root`: a custom property's raw text and a computed
       * `background-color` are not the same string, so comparing them
       * directly would fail on serialisation rather than on colour. Painting
       * the token onto a throwaway box makes both sides come out of the same
       * serialiser, which is what turns "the band has some background" into
       * "the band is on `--muted`" — the assertion that goes red if someone
       * swaps `bg-muted` for `bg-card`.
       */
      const probe = document.createElement("div");

      probe.style.backgroundColor = "var(--muted)";
      element.append(probe);

      const muted = getComputedStyle(probe).backgroundColor;

      probe.remove();

      return {
        title: box('[data-slot="dialog-header"], [data-slot="sheet-header"]'),
        footer: box('[data-slot="surface-footer"]'),
        /*
         * The ground, the rule and the band's bottom edge are what make the
         * footer a *band* rather than a row with a height, and computed style
         * is the only place they are facts rather than class names.
         */
        footerGround:
          footer === null ? "" : getComputedStyle(footer).backgroundColor,
        footerRule:
          footer === null ? "" : getComputedStyle(footer).borderTopWidth,
        /*
         * The seam at the bottom of the surface: §7 says the drawer is
         * "full-height … with the body scrolling between static bands", and a
         * flex child that shrinks but never grows leaves the band floating
         * mid-drawer over bare background on any form short enough not to
         * overflow — which the shipped `users` edit form, at three fields, is.
         * Measured against the frame's padding box for the reason the bleed
         * below is: `getBoundingClientRect` includes the border.
         */
        bottomSeam:
          footer === null
            ? -1
            : Math.round(
                element.getBoundingClientRect().bottom -
                  element.clientTop -
                  footer.getBoundingClientRect().bottom,
              ),
        muted,
      };
    });

    /*
     * **A floor for the title bar and a number for the footer**, which is the
     * asymmetry `D11.4` wrote for the grid's bands arriving here with a
     * concrete cause. The footer holds two fixed-height buttons and measures
     * 64 in both shells. The title bar holds *copy*: the users drawer's edit
     * description is a sentence about why the email is not editable, and at
     * 512px it wraps to two lines, so the band grows to hold it — which is
     * exactly what a floor is for and what an `h-15` would have clipped.
     *
     * **A ceiling as well, since `D18.11`.** The exact 60 used to be asserted
     * on the dialog below, and it stopped being true when `D18.10` lengthened
     * the staff surface's own description — leaving *nothing* pinning the rung
     * at either site, so a band that grew to 200 would have passed both. A
     * floor and a ceiling say what the band really is: §7's rung, plus at most
     * one extra line of the 13px meta text it holds. Measured at 73 for a
     * two-line description in both shells; `TITLE_BAND` names the pair once so
     * the two sites cannot drift.
     */
    expect(bands.title).toBeGreaterThanOrEqual(TITLE_BAND.min);
    expect(bands.title).toBeLessThanOrEqual(TITLE_BAND.max);
    expect(bands.footer).toBe(64);
    expect(bands.footerRule).toBe("1px");
    /*
     * `--muted` itself, resolved through the probe: asserting a literal
     * `oklch(…)` here would pin the palette in a second place and make
     * `D11.1`'s token sheet stop being the one that decides it.
     */
    expect(bands.footerGround).toBe(bands.muted);
    // The band sits on the surface's bottom edge, in both shells.
    expect(bands.bottomSeam).toBe(0);

    await page.keyboard.press("Escape");
  });
}

test("staff's dialog is 600 wide, edge to edge", async ({ app: page }) => {
  await page.goto("/staff");
  await waitForRows(page);
  await openFirstRecord(page);

  const dialog = page.getByRole("dialog");

  await expect(dialog).toBeVisible();
  await settled(dialog);

  /*
   * The one width `D11.5` moves (ADR-0054 §7) — and the bands really reaching
   * both edges of it, which is what the frame's `p-0` buys and what no class
   * assertion can see: a `p-6` left standing would leave 24px of card either
   * side of the title's rule and the footer's ground.
   */
  const frame = await dialog.boundingBox();
  const measured = await dialog.evaluate((element) => {
    const footer = element.querySelector('[data-slot="surface-footer"]');
    const header = element.querySelector('[data-slot="dialog-header"]');

    if (footer === null || header === null) return null;

    const a = element.getBoundingClientRect();
    const b = footer.getBoundingClientRect();

    return {
      /*
       * Against the frame's **padding** box, not its border box:
       * `getBoundingClientRect` includes the 1px border the dialog is drawn
       * with, so a band that really is edge to edge sits one pixel inside it.
       * `clientLeft` is that border, and subtracting it is what makes the
       * assertion about the padding the frame gave up rather than about the
       * line it keeps.
       */
      left: Math.round(b.left - (a.left + element.clientLeft)),
      right: Math.round(a.right - element.clientLeft - b.right),
      title: Math.round(header.getBoundingClientRect().height),
    };
  });

  expect(Math.round(frame?.width ?? 0)).toBe(600);
  expect(measured?.left).toBe(0);
  expect(measured?.right).toBe(0);
  /*
   * **A floor and a ceiling, not an exact 60** — corrected at `D18.11`, and
   * the correction is what this assertion was actually measuring. 60 is the
   * number ADR-0054 §7 draws and the band ships it as a `min-h`; the exact
   * form held only while the meta line under the title fitted one line at
   * this width, which made it an assertion about the **sentence** rather than
   * about the geometry. `D18.10` lengthened that sentence — the edit surface
   * now explains that the address has a flow of its own further down — and it
   * wraps here as it already did in the drawer at 512.
   *
   * The ceiling is what stops the relaxation giving the rung away: a band that
   * grew to 200 would satisfy a bare floor at both sites. `TITLE_BAND` is the
   * same pair the sibling above asserts.
   */
  expect(measured?.title).toBeGreaterThanOrEqual(TITLE_BAND.min);
  expect(measured?.title).toBeLessThanOrEqual(TITLE_BAND.max);

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
