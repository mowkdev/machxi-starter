// @ts-check
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

/**
 * The screens the operator has to look at, captured (`D11.11`).
 *
 * D11's §Definition-of-done item 3 is the one item no machine can close:
 * "the pixels are accepted by the operator — Playwright screenshots of grid
 * (both themes), record surfaces, login, popover and `/account` set beside
 * the reference screens — value equality plus a human look, never an
 * automated pixel diff". The value equality is `test:e2e`'s and the gate's;
 * this produces the other half, so that accepting or rejecting the redesign
 * is a matter of looking at two images rather than of driving the app.
 *
 * **A tool, not a spec.** It writes files and asserts nothing, so it has no
 * business in a tier that is supposed to go red on a defect — and it drives
 * the account's own theme and density, which ADR-0052's data rules keep out
 * of a suite that runs unattended. It sits beside `i18n.mjs` for the same
 * reason that does: app-level tooling that produces evidence. (`size.mjs` sat
 * here too until `D20.9` moved it to the repository root, one copy for both
 * apps — ADR-0073 §5.)
 *
 *   pnpm --filter admin shots
 *
 * against a running dev stack (`pnpm dev --filter api`, `pnpm dev --filter
 * admin`), exactly as `test:e2e` runs. It costs a sign-in and about sixty
 * requests, so it wants its own slice of ADR-0020's fifteen-minute window —
 * see `e2e/support/app.ts` for why that sentence has to be written down.
 *
 * **It puts the account back.** Theme and density are account facts
 * (ADR-0045), so a tool that walked away from `dark` would leave the
 * operator's panel in it. The original pair is read first and restored in a
 * `finally`, the same discipline `e2e/account.spec.ts` follows.
 */

const BASE_URL = process.env["E2E_BASE_URL"] ?? "http://localhost:3001";

const CREDENTIALS = {
  email: process.env["SEED_SUPER_ADMIN_EMAIL"] ?? "admin@machxi.local",
  password: process.env["SEED_SUPER_ADMIN_PASSWORD"] ?? "ChangeMe123!local",
};

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test-results",
  "reference-shots",
);

/** The root `.env`, for the same reason `playwright.config.ts` loads it. */
try {
  process.loadEnvFile(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env"),
  );
} catch {
  /* No root `.env` — the defaults and the ambient environment carry it. */
}

/** The option labels, keyed by the enum the settings row stores. */
const THEME_LABELS = { light: "Light", dark: "Dark", system: "System" };
const DENSITY_LABELS = { comfortable: "Comfortable", compact: "Compact" };

const signIn = async (page) => {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel("Email").fill(CREDENTIALS.email);
  await page.getByLabel("Password").fill(CREDENTIALS.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page
    .getByRole("heading", { name: "Dashboard", level: 1 })
    .waitFor({ state: "visible" });
};

/** What the account is on now, read off the checked radio. */
const chosen = async (page, name) =>
  page.locator(`input[name="${name}"]:checked`).getAttribute("value");

/**
 * Chooses an option and waits for the `PATCH` to land.
 *
 * The label is clicked because the radio is `sr-only` — it is the control,
 * and the box a pointer meets is the `<label>` around it.
 */
const choose = async (page, group, label) => {
  const radio = page
    .locator(`input[name="${group}"]`)
    .and(page.getByRole("radio", { name: label, exact: true }));

  /*
   * Already in force is not a write, and waiting for one hangs. A radio
   * that is checked fires no `change` on a second click, so the `PATCH`
   * below never comes — which is how the restore at the end of the first
   * run timed out after every screenshot had been taken: the walk ends on
   * `dark`, and `dark` is what this account was on to begin with.
   */
  if (await radio.isChecked()) return;

  const patched = page.waitForResponse(
    (response) =>
      response.url().endsWith("/admin/settings") &&
      response.request().method() === "PATCH",
  );

  await radio.locator("xpath=ancestor::label[1]").click();

  await patched;
};

const shoot = async (page, name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  process.stdout.write(`  ${name}.png\n`);
};

/** Every screen the item names, in one theme. */
const walk = async (page, theme) => {
  await page.goto(`${BASE_URL}/staff`);
  await page.locator("tbody tr").first().waitFor({ state: "visible" });
  await shoot(page, `grid-staff-${theme}`);

  /* The dialog surface (`staff` declares it) and the drawer (`users`). */
  await page
    .getByRole("button", { name: /^Row actions for/ })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.getByRole("dialog").waitFor({ state: "visible" });
  await shoot(page, `record-dialog-${theme}`);
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.goto(`${BASE_URL}/users`);
  await page.locator("tbody tr").first().waitFor({ state: "visible" });
  await page
    .getByRole("button", { name: /^Row actions for/ })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page
    .locator('[data-slot="sheet-content"]')
    .waitFor({ state: "visible" });
  await shoot(page, `record-drawer-${theme}`);
  await page.keyboard.press("Escape");

  /* The popover, which ADR-0053 §2 slimmed to identity and exit. */
  await page.goto(`${BASE_URL}/`);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByRole("menu").waitFor({ state: "visible" });
  await shoot(page, `account-menu-${theme}`);
  await page.keyboard.press("Escape");

  await page.goto(`${BASE_URL}/account/profile`);
  await page.locator('[data-slot="settings-content"]').waitFor();
  await shoot(page, `account-profile-${theme}`);

  await page.goto(`${BASE_URL}/account/preferences`);
  await page.locator('[data-slot="settings-content"]').waitFor();
  await shoot(page, `account-preferences-${theme}`);
};

/**
 * The login, which is the one screen with no account behind it.
 *
 * A fresh context, so the theme cannot come from the signed-in session —
 * signed out, the app is the device cache alone (ADR-0045 §The server
 * adapter), which is what `applyTheme` writes and what this seeds.
 */
const shootLogin = async (browser, theme) => {
  const context = await browser.newContext();

  try {
    await context.addInitScript((value) => {
      window.localStorage.setItem("machxi.admin.theme", value);
    }, theme);

    const page = await context.newPage();

    await page.goto(`${BASE_URL}/login`);
    await page.getByRole("button", { name: "Sign in" }).waitFor();
    await shoot(page, `login-${theme}`);
  } finally {
    await context.close();
  }
};

const main = async () => {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  await signIn(page);
  await page.goto(`${BASE_URL}/account/preferences`);

  const theme = await chosen(page, "theme");
  const density = await chosen(page, "gridDensity");

  /*
   * **Nothing is driven until both values are known.** A `null` here means
   * the preferences page did not render its radios — a boot that failed, a
   * renamed group — and carrying on would walk the account through four
   * settings with no record of where to put it back. Refusing before the
   * first write is the only point at which that is still free.
   */
  if (theme === null || density === null) {
    await browser.close();
    throw new Error(
      "Could not read the account's current theme and density from " +
        "/account/preferences — refusing to change settings this run " +
        "cannot restore.",
    );
  }

  try {
    for (const next of ["light", "dark"]) {
      await choose(page, "theme", THEME_LABELS[next]);
      await walk(page, next);
      await shootLogin(browser, next);
    }

    /*
     * Both densities, in one theme: the mode moves the row height, the cell
     * padding and the in-row badge (ADR-0054 §6) and nothing about colour,
     * so a second theme here would be the same comparison twice.
     */
    await page.goto(`${BASE_URL}/account/preferences`);

    for (const next of ["comfortable", "compact"]) {
      await choose(page, "gridDensity", DENSITY_LABELS[next]);
      await page.goto(`${BASE_URL}/staff`);
      await page.locator("tbody tr").first().waitFor({ state: "visible" });
      await shoot(page, `grid-density-${next}`);
      await page.goto(`${BASE_URL}/account/preferences`);
    }
  } finally {
    /*
     * The account goes back whatever happened (ADR-0045) — and each half
     * goes back **independently**, because a restore that throws must not
     * take the one after it down with it. The first version of this block
     * chained them, and when the theme restore hung the density was left on
     * whatever the walk had set: one failure, two wrong settings.
     *
     * `browser.close()` is last and outside both, so the process never ends
     * holding a chromium open on a bad path.
     */
    try {
      await page.goto(`${BASE_URL}/account/preferences`);

      for (const [group, labels, value] of [
        ["theme", THEME_LABELS, theme],
        ["gridDensity", DENSITY_LABELS, density],
      ]) {
        try {
          await choose(page, group, labels[value]);
        } catch (cause) {
          process.stderr.write(
            `could not restore ${group} to ${value}: ${String(cause)}\n`,
          );
        }
      }
    } finally {
      await browser.close();
    }
  }

  process.stdout.write(`\nWritten to ${OUT}\n`);
  process.stdout.write(
    "Set these beside the reference artboards — D11 §Definition-of-done item 3.\n",
  );
};

await main();
