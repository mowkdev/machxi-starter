import { expect, test } from "./support/fixtures";

/**
 * The login screen, measured (`D11.7`, ADR-0054 §7).
 *
 * The component tier asserts the class strings and the ground's inline paint;
 * none of that proves a pixel — Tailwind still has to have *generated*
 * `max-w-[400px]` and `h-[38px]`, and `tailwind-merge` still has to have
 * dropped `Input`'s own `h-9` rather than losing to it on source order. This
 * is the tier where those become values.
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
test("is a 400px column of 38px controls on a 48px hairline ground", async ({
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
    const column = document.querySelector('[data-slot="auth-column"]');
    const email = document.querySelector("#email");
    const submit = document.querySelector('button[type="submit"]');
    const title = document.querySelector("h1");

    const box = (node: Element | null) => node?.getBoundingClientRect();

    return {
      backgroundSize:
        ground === null ? "" : getComputedStyle(ground).backgroundSize,
      column: Math.round(box(column)?.width ?? 0),
      /*
       * The column's distance from the viewport's left edge — the half of
       * "left-aligned" a width cannot say. `md:px-24` is two 48px modules, so
       * the column's left edge lands on a grid line rather than near one.
       */
      columnLeft: Math.round(box(column)?.left ?? 0),
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

  // Two gradients, each tiled on the same 48px module.
  expect(geometry.backgroundSize).toBe("48px 48px, 48px 48px");
  expect(geometry.column).toBe(400);
  expect(geometry.columnLeft).toBe(96);
  expect(geometry.email).toBe(38);
  expect(geometry.submit).toBe(38);
  expect(geometry.titleSize).toBe("28px");
  expect(geometry.titleLeading).toBe("34px");
  expect(geometry.emailFont).toBe("13px");
  expect(geometry.submitFont).toBe("13px");
});
