import { expect, test } from "./support/fixtures";

import { waitForRows } from "./support/app";

/**
 * The navigation indicator, on a route that is deliberately made slow
 * (`D10.4`, ADR-0052 §Felt navigation).
 *
 * **`D10.1` measured the delay away and left the pixels uncertified**: warm
 * navigations in a production build resolve in 66–117 ms, which is exactly why
 * the bar is invisible in normal use and why a spec that clicked a nav item
 * and looked would be a coin flip. So the route is held open on purpose —
 * the record route's loader awaits a detail response this spec refuses to
 * deliver until it has looked (ADR-0052's "deliberately delayed by request
 * interception, so the spec is deterministic").
 */

test("the bar appears while a route is unresolved, and leaves when it settles", async ({
  app: page,
}) => {
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.goto("/staff");
  await waitForRows(page);

  /*
   * Only the *detail* request, and only from here on. Holding the list would
   * hold the screen this spec navigates away from, and holding everything
   * would hold the chunk the record surface itself is made of.
   */
  const detail = /\/admin\/staff\/[0-9a-f-]{36}$/;

  await page.route(detail, async (route) => {
    await held;
    await route.continue();
  });

  await page
    .getByRole("button", { name: /^Row actions for/ })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Edit" }).click();

  const bar = page.getByRole("progressbar", { name: "Navigating" });

  /*
   * From here on, `finally`. The context outlives this spec (see
   * `support/fixtures.ts`), so an assertion that throws while a request is
   * held leaves the route blocked and the dialog open — and the next file
   * hangs sixty seconds on a request nobody is going to answer, reporting a
   * second failure that says nothing. Cleanup on the failing path is what
   * keeps a red run honest about which spec broke.
   */
  try {
    await expect(bar).toBeVisible();

    /*
     * And the old screen is still behind it — the decision ADR-0052 took over a
     * pending component, which would have replaced the list with a skeleton on
     * every click. The operator keeps what they were reading *and* learns that
     * something is happening.
     */
    await expect(page.locator("tbody tr").first()).toBeVisible();

    /*
     * Painted rather than merely present: the bar is two pixels of colour at the
     * top of the inset, and a zero-height or transparent one would satisfy every
     * jsdom assertion in the package suite.
     */
    const box = await bar.boundingBox();

    expect(box?.height).toBeGreaterThan(0);
    expect(box?.width).toBeGreaterThan(100);

    release?.();

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(bar).toBeHidden();
  } finally {
    release?.();
    await page.unroute(detail);
    await page
      .getByRole("button", { name: "Cancel" })
      .click()
      .catch(() => undefined);
  }
});
