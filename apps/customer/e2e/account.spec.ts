import type { Page } from "@playwright/test";

import { expect, test } from "./support/fixtures";

import {
  THEME_LABELS,
  choose,
  chosen,
  labelFor,
  leadCard,
  settingsNav,
} from "./support/app";

/**
 * The account area, walked (`D12.10`; ADR-0053, ADR-0055 §3).
 *
 * **What is left over for this tier, and what is deliberately not here.** The
 * component suite already asserts the section links' `data-active`, the three
 * option groups' write paths and the index redirect's `beforeLoad` — against a
 * router in jsdom, where a preference is a call on a stub and a navigation
 * never leaves the process. What only a browser proves is that each section
 * comes up from a **cold URL** — a real document boot, csrf and refresh and the
 * guard, before the router has any idea where it is — and that a *chosen*
 * preference reaches the account row and comes back painted.
 *
 * **`SettingsLayout`'s own geometry is not re-measured here.** The 220px nav
 * column, the 32px gap and the 720px content cap are `@repo/ui`'s (ADR-0054
 * §7), and `apps/admin`'s browser tier already measures them in a laid-out
 * browser; this app changed nothing about that composition, which is the whole
 * second-consumer claim `D12.6` made. ADR-0052 scopes this tier to what jsdom
 * cannot see, not to a second place to assert what another browser already did.
 *
 * **Invariant-style, per ADR-0052's data rules.** The dev database drifts and
 * the fixture account carries whatever the last run left, so nothing here
 * asserts a starting value: each preference case reads what the account is on,
 * moves it, and puts it back. A settings write is a `PATCH /user/settings`
 * (ADR-0045), so walking away from one would leave the fixture customer's own
 * app in whatever colour a failed assertion stopped on.
 */

/**
 * The three sections, by what the nav calls them and what they open with.
 *
 * The lead card is what proves the *right* section rendered: the nav's active
 * marking is drawn from the same router state the URL is, so a section that
 * mounted the wrong pane would still light the right link.
 */
const SECTIONS = [
  { path: "/account/profile", nav: "Profile", card: "Your details" },
  { path: "/account/security", nav: "Security", card: "Password" },
  { path: "/account/preferences", nav: "Preferences", card: "Appearance" },
] as const;

/*
 * `chosen`, `choose`, `THEME_LABELS` and `labelFor` were written here at
 * `D12.10` and moved into `support/app.ts` at `D13.9`, when
 * `impersonation.spec.ts` needed the same settings round trip. The reasoning
 * for each is now in that file, beside the code.
 */

/** Whether `<html>` is painted dark — `applyTheme`'s one observable effect. */
const painted = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.documentElement.classList.contains("dark"));

/** Endonyms, so the restore is legible whatever language the case left. */
const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  lv: "Latviešu",
};

for (const { path, nav, card } of SECTIONS) {
  test(`${path} opens from a cold URL, and the nav marks it`, async ({
    app: page,
  }) => {
    await page.goto(path);

    await expect(leadCard(page)).toHaveText(card);

    const links = settingsNav(page);

    await expect(links.getByRole("link")).toHaveCount(SECTIONS.length);
    await expect(
      links.getByRole("link", { name: nav, exact: true }),
    ).toHaveAttribute("data-active", "true");

    /*
     * Exactly one, which is the claim the attribute alone does not make:
     * `activeProps` with a loose match would mark `/account/profile` while
     * standing on `/account/preferences` and every per-link assertion would
     * still pass.
     */
    await expect(links.locator('a[data-active="true"]')).toHaveCount(1);
  });
}

test("the area's own address lands on the first section", async ({
  app: page,
}) => {
  /*
   * `/account` is the area's index and it redirects in `beforeLoad` (ADR-0053
   * §1), so what only a browser proves is that no frame renders on the way —
   * the address bar never shows the address that was asked for, and the
   * content pane is never empty. This app has no retired `/profile` address to
   * check beside it: it was built after ADR-0053 and never had the screen
   * anywhere else.
   */
  await page.goto("/account");

  await expect(page).toHaveURL(/\/account\/profile$/);
  await expect(leadCard(page)).toHaveText("Your details");
});

test("the appearance choice is written, and taken back", async ({
  app: page,
}) => {
  await page.goto("/account/preferences");

  const before = await chosen(page, "theme");
  const target = before === "dark" ? "light" : "dark";

  try {
    await choose(page, "theme", labelFor(THEME_LABELS, target));

    /*
     * The class on `<html>`, not the radio: `setTheme` paints, caches and
     * publishes, and only the paint is a thing the customer sees. A control
     * that flipped without `applyTheme` running would be green above.
     */
    expect(await painted(page)).toBe(target === "dark");
  } finally {
    /*
     * Tolerant, because this is cleanup on the failing path too: a restore that
     * threw inside `finally` would replace the failure that is worth reading.
     * The happy path asserts it landed, below.
     */
    await choose(page, "theme", labelFor(THEME_LABELS, before)).catch(
      () => undefined,
    );
  }

  expect(await chosen(page, "theme")).toBe(before);

  /*
   * The paint is only asserted for the two themes that name a colour. `system`
   * resolves through `prefers-color-scheme`, so on an account sitting on it
   * this line would be asserting the *harness's* colour scheme — Playwright's
   * default happens to be light, which is exactly the kind of accident that
   * passes for years and then does not. `target` is never `system`, so only
   * the restore needs the guard.
   */
  if (before !== "system") {
    expect(await painted(page)).toBe(before === "dark");
  }
});

test("the language choice is written, and taken back", async ({
  app: page,
}) => {
  await page.goto("/account/preferences");

  const before = await chosen(page, "locale");
  const target = before === "lv" ? "en" : "lv";

  try {
    await choose(page, "locale", labelFor(LOCALE_LABELS, target));

    /*
     * `<html lang>` carries the Intl tag rather than the enum (ADR-0046 §5),
     * which is what makes this worth a browser: the tag is what a screen reader
     * and the platform's own hyphenation read, and nothing in jsdom would
     * notice `lv` being written there instead of `lv-LV`.
     */
    await expect(page.locator("html")).toHaveAttribute(
      "lang",
      target === "lv" ? "lv-LV" : "en-GB",
    );

    /*
     * And the copy moved with it. The section nav is this app's own catalogue,
     * so this is `lv` reaching a rendered screen rather than a string existing
     * in a JSON file — the half of `D12.9`'s sweep that only a browser can
     * see.
     */
    await expect(
      settingsNav(page).getByRole("link", {
        name: target === "lv" ? "Iestatījumi" : "Preferences",
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await choose(page, "locale", labelFor(LOCALE_LABELS, before)).catch(
      () => undefined,
    );
  }

  expect(await chosen(page, "locale")).toBe(before);
});
