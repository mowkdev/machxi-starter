import type { Page } from "@playwright/test";

import { expect, test } from "./support/fixtures";

import { OPERATOR_EMAIL, signIn, waitForRows } from "./support/app";

/**
 * The account area, walked (`D11.11`; ADR-0053, ADR-0054 §7).
 *
 * **The one tier that can walk it.** The package and admin suites already
 * assert the menu's inventory, the section links' `data-active`, the three
 * option groups' write paths and the redirects' `beforeLoad` — all against
 * a router in jsdom, where a preference is a call on a stub and a pane has
 * no width. What is left over is exactly this file's: that a *chosen*
 * preference reaches the account row and comes back to a browser that has
 * never seen it, that the two panes are the reference's measures, and that
 * the density mode's two surfaces cannot disagree across a navigation.
 *
 * **Invariant-style, per ADR-0052's data rules.** The dev database drifts
 * and the operator account carries whatever the last run left, so nothing
 * here asserts a starting value: each preference test reads what the
 * account is on, moves it, and puts it back — the columns-menu spec's rule,
 * one deliverable along, and for the same reason. A settings write is a
 * `PATCH /admin/settings` (ADR-0045), so walking away from one would leave
 * the operator's own panel in whatever colour a failed assertion stopped
 * on.
 */

const settingsNav = (page: Page) => page.locator('[data-slot="settings-nav"]');

const settingsContent = (page: Page) =>
  page.locator('[data-slot="settings-content"]');

/** The first card a section puts up — what proves the right one rendered. */
const leadCard = (page: Page) =>
  settingsContent(page).locator('[data-slot="card-title"]').first();

/**
 * The three sections, by what the nav calls them and what they open with.
 *
 * A card title is a `div` (the shadcn primitive's, ADR-0047), not a
 * heading, so it is reached by its slot rather than by role — the one
 * place in this file that names a DOM detail, and it names the design
 * system's own contract rather than a class.
 */
const SECTIONS = [
  { path: "/account/profile", nav: "Profile", card: "Your account" },
  { path: "/account/security", nav: "Security", card: "Password" },
  { path: "/account/preferences", nav: "Preferences", card: "Appearance" },
] as const;

/**
 * The option an account is currently on, read as the enum the API stores.
 *
 * `:checked` rather than a role query, deliberately: every other assertion
 * here names a control the way an operator finds it, but what has to be
 * put back afterwards is the *value* — `dark`, `compact`, `lv` — and a
 * label would make the restore depend on the language the previous case
 * left the panel in.
 */
const chosen = async (page: Page, name: string): Promise<string> => {
  const value = await page
    .locator(`input[name="${name}"]:checked`)
    .getAttribute("value");

  if (value === null) throw new Error(`no ${name} option is checked`);

  return value;
};

/**
 * Chooses an option and waits for the account row to have taken it.
 *
 * **The label is clicked, not the input.** `SettingsOptions` renders a
 * native radio that is `sr-only` — it *is* the control, so it is present
 * to the keyboard and to a screen reader — and the box an operator points
 * at is the `<label>` wrapped around it. The radio is still what the
 * assertion names, which is what keeps the accessible name under test.
 *
 * **And the wait is on the request, not on a timeout.** Theme and density
 * ride ADR-0045's coalescing writer, whose window is a second; the locale
 * goes straight through. Waiting for the `PATCH` covers both without this
 * file knowing which is which — and without it, the round trip would
 * assert a radio the app had flipped locally and call that persistence.
 */
const choose = async (
  page: Page,
  name: string,
  label: string,
): Promise<void> => {
  /*
   * The role and the group, together: the accessible name is what an
   * operator reads and the radio `name` is what makes the set a set — the
   * one property `D11.10`'s review found untested and the reason
   * `packages/ui` gains no Radix primitive for this. A label matched
   * outside its own group would be a control this helper drove by
   * accident.
   */
  const radio = page
    .locator(`input[name="${name}"]`)
    .and(page.getByRole("radio", { name: label, exact: true }));

  /*
   * **Already in force is not a write, and waiting for one hangs.** A checked
   * radio fires no `change` on a second click, so no `PATCH` follows and the
   * wait below burns its full timeout — which matters most on the restore
   * path, where a forward `choose` that failed before it moved anything
   * leaves the option exactly where this call is about to ask for it.
   */
  if (await radio.isChecked()) return;

  /*
   * Registered before the click, so a fast `PATCH` cannot be missed. The
   * status is asserted after the await rather than filtered inside the
   * predicate: a rejected write would otherwise not match, and the failure
   * would read as "timed out waiting for a response" instead of naming the
   * status the API actually sent.
   */
  const patched = page.waitForResponse(
    (response) =>
      response.url().endsWith("/admin/settings") &&
      response.request().method() === "PATCH",
  );

  await radio.locator("xpath=ancestor::label[1]").click();

  await expect(radio).toBeChecked();
  expect((await patched).status()).toBe(200);
};

/** Whether `<html>` is painted dark — `applyTheme`'s one observable effect. */
const painted = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.documentElement.classList.contains("dark"));

const THEME_LABELS: Record<string, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

const DENSITY_LABELS: Record<string, string> = {
  comfortable: "Comfortable",
  compact: "Compact",
};

/** Endonyms, so the restore is legible whatever language the case left. */
const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  lv: "Latviešu",
};

const labelFor = (labels: Record<string, string>, value: string): string => {
  const label = labels[value];

  if (label === undefined) throw new Error(`no label for ${value}`);

  return label;
};

test("the menu names the area, and the drawer names none of it", async ({
  app: page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  /*
   * ADR-0053 §3: the drawer is domain navigation and the account is not a
   * domain. The unit suite asserts the item left `NAVIGATION`; this asserts
   * nothing else put one back — a `SidebarFooter` link would satisfy that
   * suite and fail here.
   */
  const drawer = page.locator('[data-slot="sidebar-container"]');

  await expect(
    drawer.getByRole("link", { name: /account|profile/i }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Account", exact: true }).click();

  const menu = page.getByRole("menu");

  /*
   * ADR-0053 §2's slim menu, as an inventory: identity, one way in, the way
   * out. `toHaveText` over the whole set is what makes a fourth entry a
   * failure rather than an unnoticed addition.
   */
  await expect(menu.getByRole("menuitem")).toHaveText(["Account", "Sign out"]);
  await expect(menu.getByRole("menuitemradio")).toHaveCount(0);
  /*
   * `.last()`, because the label renders the address twice on an account
   * with no name: `displayName` falls back to the email, so the two spans
   * carry the same text and a bare `getByText` fails on strict mode rather
   * than on the claim. The seeded super admin has a name, so this is
   * hardening against a state an operator can reach through
   * `/account/profile` rather than against one that exists today.
   */
  await expect(menu.getByText(OPERATOR_EMAIL).last()).toBeVisible();

  await menu.getByRole("menuitem", { name: "Account", exact: true }).click();

  /*
   * The entry names the *area* and the index route chooses the section
   * (ADR-0053 §1), so the click lands one redirect deeper than it aimed.
   */
  await expect(page).toHaveURL(/\/account\/profile$/);
  await expect(leadCard(page)).toHaveText("Your account");
});

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
     * standing on `/account/preferences` and every per-link assertion
     * would still pass.
     */
    await expect(links.locator('a[data-active="true"]')).toHaveCount(1);
  });
}

test("both retired addresses land on the first section", async ({
  app: page,
}) => {
  /*
   * `/account` is the area's own index and `/profile` is where the screen
   * used to live (ADR-0053 §1). Both are `beforeLoad` redirects, so what
   * only a browser proves is that neither renders a frame on the way — the
   * address bar never shows the address that was asked for.
   */
  for (const from of ["/account", "/profile"]) {
    await page.goto(from);

    await expect(page).toHaveURL(/\/account\/profile$/);
    await expect(leadCard(page)).toHaveText("Your account");
  }
});

test("the area is the reference's two panes", async ({ app: page }) => {
  /*
   * **Pinned wide, because the cap is what is being measured.** At the
   * default 1280 the content column has about twenty pixels of room over its
   * own 720 — less once a document scrollbar takes some, since `/account/*`
   * is not a `fullHeight` route — and below roughly 1260 the pane stops
   * being capped and starts being merely narrow, which fails this case for a
   * reason that has nothing to do with the layout. The page is worker-scoped,
   * so it is put back; `record-surfaces.spec.ts` restores the same pair for
   * the same reason.
   */
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/account/profile");
  await expect(leadCard(page)).toBeVisible();

  /*
   * ADR-0054 §7 as amended at `D11.8`: a 220px nav column, a 32px gap and a
   * content column capped at 720. `packages/ui`'s own suite asserts the
   * classes; only a laid-out browser says the values reached the pixels —
   * and the cap is the one that would go unnoticed, since an uncapped pane
   * looks like a pane until the window is wide.
   *
   * Rounded, for the reason `shell.spec.ts` rounds: a browser reports
   * fractional box heights and asserting an integer to the pixel is
   * asserting a rounding mode. The default viewport is Desktop Chrome's
   * 1280, well above both the `md` collapse and the 720 cap.
   */
  const geometry = await page.evaluate(() => {
    const nav = document.querySelector('[data-slot="settings-nav"]');
    const content = document.querySelector('[data-slot="settings-content"]');

    if (nav === null || content === null) return null;

    const navBox = nav.getBoundingClientRect();
    const contentBox = content.getBoundingClientRect();

    return {
      nav: Math.round(navBox.width),
      gap: Math.round(contentBox.left - navBox.right),
      content: Math.round(contentBox.width),
    };
  });

  expect(geometry?.nav).toBe(220);
  expect(geometry?.gap).toBe(32);
  expect(geometry?.content).toBe(720);

  await page.setViewportSize({ width: 1280, height: 720 });
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
     * publishes, and only the paint is a thing the operator sees. A control
     * that flipped without `applyTheme` running would be green above.
     */
    expect(await painted(page)).toBe(target === "dark");
  } finally {
    /*
     * Tolerant, for the columns-menu spec's reason: this is cleanup on the
     * failing path too, and a restore that throws inside `finally` would
     * replace the failure that is worth reading. The happy path asserts it
     * landed, below.
     */
    await choose(page, "theme", labelFor(THEME_LABELS, before)).catch(
      () => undefined,
    );
  }

  expect(await chosen(page, "theme")).toBe(before);

  /*
   * The paint is only asserted for the two themes that name a colour.
   * `system` resolves through `prefers-color-scheme` (`resolveTheme`), so on
   * an account sitting on it this line would be asserting the *harness's*
   * colour scheme — Playwright's default happens to be light, which is
   * exactly the kind of accident that passes for years and then does not.
   * `target` is never `system`, so only the restore needs the guard.
   */
  if (before !== "system") {
    expect(await painted(page)).toBe(before === "dark");
  }
});

test("the density choice is written, and both its surfaces agree", async ({
  app: page,
}) => {
  await page.goto("/account/preferences");

  const before = await chosen(page, "gridDensity");
  const target = before === "compact" ? "comfortable" : "compact";

  /**
   * The mode, seen from the grid it is about, and back again.
   *
   * **The second surface** (`D11.10`): the page-header band's toggle.
   * ADR-0053 §2 allows the double placement precisely because the two
   * cannot disagree — one `setDensity`, one account fact — and this is
   * the only tier where that claim spans a navigation rather than a
   * re-render.
   *
   * **And the height itself** (ADR-0054 §6): Comfortable 44, Compact 34.
   * `grid-layout.spec.ts` measures whichever mode the account happens
   * to be on, because it must not write one; this walk drives the mode,
   * so it is where both numbers are measured on every run — the
   * arrangement that file's comment deferred here.
   */
  const onTheGrid = async (mode: string): Promise<void> => {
    /*
     * Clicked, not `goto`. A document navigation re-boots the app —
     * `GET /auth/csrf`, a refresh, the settings and the profile — and this
     * walk crosses to a grid and back four times. Against the global request
     * window (see `support/app.ts`, which reads its size off the response
     * rather than stating one) that is a tier paying for its own throttling;
     * a click is one list request, and it is also what
     * an operator actually does.
     */
    await page
      .locator('[data-slot="sidebar-container"]')
      .getByRole("link", { name: "Staff", exact: true })
      .click();

    await waitForRows(page);

    await expect(
      page.getByRole("button", { name: "Compact rows", exact: true }),
    ).toHaveAttribute("aria-pressed", String(mode === "compact"));

    const row = await page.evaluate(() =>
      Math.round(
        document.querySelector("tbody tr")?.getBoundingClientRect().height ?? 0,
      ),
    );

    expect(row).toBe(mode === "compact" ? 34 : 44);

    /* Back through history, which is a pop rather than a second boot. */
    await page.goBack();
    await expect(
      page.getByRole("radio", { name: "Comfortable", exact: true }),
    ).toBeVisible();
  };

  try {
    await choose(page, "gridDensity", labelFor(DENSITY_LABELS, target));
    await onTheGrid(target);
  } finally {
    /*
     * **Back to the section before restoring, because this is the one case
     * whose body leaves it.** `onTheGrid` asserts on `/staff`, where no
     * `input[name="gridDensity"]` exists — so a failure there would send the
     * restore looking for a control that is not on the page, and the account
     * would keep a density the operator never chose.
     */
    await page.goto("/account/preferences").catch(() => undefined);

    await choose(page, "gridDensity", labelFor(DENSITY_LABELS, before)).catch(
      () => undefined,
    );
  }

  expect(await chosen(page, "gridDensity")).toBe(before);
  await onTheGrid(before);
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
     * `<html lang>` carries the Intl tag rather than the enum (ADR-0046
     * §5), which is what makes this worth a browser: the tag is what a
     * screen reader and the platform's own hyphenation read, and nothing
     * in jsdom would notice `lv` being written there instead of `lv-LV`.
     */
    await expect(page.locator("html")).toHaveAttribute(
      "lang",
      target === "lv" ? "lv-LV" : "en-GB",
    );

    /*
     * And the copy moved with it. The section nav is the app's own, so this
     * is the catalogue reaching a rendered screen rather than a string
     * existing in a JSON file.
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

test("a preference chosen here is in force in a browser that has never seen it", async ({
  app: page,
  browser,
}) => {
  await page.goto("/account/preferences");

  const before = await chosen(page, "theme");

  /*
   * **The target is `dark`, always, and that is the whole rigour of this
   * case.** Deriving it as "whatever the account is not" makes the assertion
   * vacuous half the time: a fresh context has an empty `localStorage` *and*
   * Playwright pins `colorScheme: "light"`, so an app that never read the
   * settings row at all boots light — and an account already on `dark` would
   * have this case assert exactly that default and pass. `dark` is the one
   * value a fresh browser cannot arrive at on its own, so it is the only
   * value worth travelling to.
   */
  const target = "dark";

  try {
    /*
     * From `light` first when the account is already dark, so the write this
     * case depends on is a real one rather than a click on a checked radio.
     */
    if (before === target) {
      await choose(page, "theme", labelFor(THEME_LABELS, "light"));
    }

    await choose(page, "theme", labelFor(THEME_LABELS, target));

    /*
     * **The claim the whole settings design exists for** (ADR-0045): the
     * preference is the *account's*, not the device's. A fresh context has
     * an empty `localStorage`, so the theme it boots into cannot have come
     * from `applyTheme`'s cache — it can only have come from
     * `GET /admin/settings`.
     *
     * A second context rather than a reload for exactly that reason, and a
     * second *sign-in* rather than `storageState`, which this suite cannot
     * use at all: ADR-0018 rotates the refresh token, so a copied state
     * spends a token the original context still needs (`support/fixtures.ts`).
     * Two logins in a run sit well inside ADR-0020's ten per fifteen
     * minutes; a login per test does not, which is why this is the only
     * case that pays for one.
     */
    const context = await browser.newContext();

    try {
      const fresh = await context.newPage();

      await signIn(fresh);

      /*
       * Polled: the theme is adopted when the settings query settles, which
       * is after the dashboard heading this sign-in waited for.
       */
      await expect(async () => {
        expect(await painted(fresh)).toBe(true);
      }).toPass();
    } finally {
      await context.close();
    }
  } finally {
    await choose(page, "theme", labelFor(THEME_LABELS, before)).catch(
      () => undefined,
    );
  }

  expect(await chosen(page, "theme")).toBe(before);
});
