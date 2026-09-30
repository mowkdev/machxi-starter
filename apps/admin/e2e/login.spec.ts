import { expect, test } from "./support/fixtures";

/**
 * The login screen, measured (`D11.7`, ADR-0054 §7; redrawn at `D31.2` as one
 * centred card on a gradient ground, ADR-0080 §3).
 *
 * The component tier asserts the class strings; none of that proves a pixel —
 * Tailwind still has to have *generated* `max-w-[400px]`, `h-[38px]` and the
 * gradient's two stops, and `tailwind-merge` still has to have dropped
 * `Input`'s own `h-9` rather than losing to it on source order. This is the
 * tier where those become values.
 *
 * **It takes `page`, not `app`** — the worker-scoped fixture signs in, and
 * this is the one screen that only exists signed *out*. That costs one
 * anonymous boot, whose refresh fails by definition, so the whole claim is
 * made in **one navigation**: ADR-0020's refresh limiter allows five failures
 * per quarter hour per IP, and a spec that navigated once per assertion would
 * spend that budget on itself (`support/fixtures.ts` records the same
 * arithmetic from the other direction).
 *
 * Rounded, for the reason `grid-layout.spec.ts` and `shell.spec.ts` round: a
 * browser reports fractional box heights and asserting an integer to the pixel
 * would be asserting a rounding mode.
 */
test("is one 400px card of 38px controls, centred on a gradient ground", async ({
  page,
}) => {
  await page.goto("/login");

  /*
   * The shell, not the address bar: this app boots `GET /auth/csrf` →
   * `POST /auth/refresh` behind a loading gate before any chrome renders
   * (ADR-0033), so an `evaluate` fired straight after the navigation measures
   * an empty page and reports zeroes.
   */
  const heading = page.getByRole("heading", { name: "Sign in", level: 1 });

  await expect(heading).toBeVisible();

  const geometry = await page.evaluate(() => {
    const ground = document.querySelector('[data-slot="auth-ground"]');
    const card = document.querySelector("h1")?.closest('[data-slot="card"]');
    const email = document.querySelector("#email");
    const submit = document.querySelector('button[type="submit"]');
    const title = document.querySelector("h1");

    const box = (node: Element | null | undefined) =>
      node?.getBoundingClientRect();
    const cardBox = box(card);
    const groundBox = box(ground);

    return {
      backgroundImage:
        ground === null ? "" : getComputedStyle(ground).backgroundImage,
      card: Math.round(cardBox?.width ?? 0),
      /*
       * The card's centre against the ground's, on both axes — the half of
       * "centred" a width cannot say.
       */
      offsetX: Math.round(
        (cardBox === undefined || groundBox === undefined
          ? Number.NaN
          : cardBox.left + cardBox.width / 2) -
          ((groundBox?.left ?? 0) + (groundBox?.width ?? 0) / 2),
      ),
      offsetY: Math.round(
        (cardBox === undefined || groundBox === undefined
          ? Number.NaN
          : cardBox.top + cardBox.height / 2) -
          ((groundBox?.top ?? 0) + (groundBox?.height ?? 0) / 2),
      ),
      email: Math.round(box(email)?.height ?? 0),
      submit: Math.round(box(submit)?.height ?? 0),
      titleSize: title === null ? "" : getComputedStyle(title).fontSize,
      titleLeading: title === null ? "" : getComputedStyle(title).lineHeight,
      /*
       * §3's control type, and the one claim only this tier can make: the
       * viewport is 1280 wide, so the `md:` breakpoint is *active* here and
       * `Input`'s own `md:text-sm` is live. A login that spelled `text-[13px]`
       * without its `md:` twin passes every jsdom assertion and renders 14px
       * on every desktop.
       */
      emailFont: email === null ? "" : getComputedStyle(email).fontSize,
      submitFont: submit === null ? "" : getComputedStyle(submit).fontSize,
    };
  });

  // One gradient, and no tiled hairline grid beside it.
  expect(geometry.backgroundImage).toMatch(/^linear-gradient\(/);
  expect(geometry.backgroundImage).not.toContain("), linear-gradient(");
  /*
   * Both stops generated: a missing `from-*` or `to-*` utility falls back to
   * Tailwind's transparent `@property` initial value, and neither token is
   * transparent.
   */
  expect(geometry.backgroundImage).not.toContain("rgba(0, 0, 0, 0)");
  expect(geometry.card).toBe(400);
  expect(Math.abs(geometry.offsetX)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.offsetY)).toBeLessThanOrEqual(1);
  expect(geometry.email).toBe(38);
  expect(geometry.submit).toBe(38);
  expect(geometry.titleSize).toBe("28px");
  expect(geometry.titleLeading).toBe("34px");
  expect(geometry.emailFont).toBe("13px");
  expect(geometry.submitFont).toBe("13px");
});
