import { expect, type Locator, type Page } from "@playwright/test";

/**
 * What every spec needs and no spec should re-derive (`D10.4`).
 *
 * Sign-in, the two grids, and the handful of locators the walk keeps reaching
 * for. Everything here is named by **role and accessible name**, the same
 * discipline ADR-0036 imposes on the component tier — a control this file
 * cannot name is one a screen reader cannot name either.
 */

/**
 * The operator the suite signs in as (ADR-0052 §The browser tier).
 *
 * Environment first, the seeded super admin as the default — so a machine with
 * a different seed passes its own credentials in and nothing here is a secret
 * or a fixture. These are the same variables `pnpm db:setup` seeds from, which
 * is what makes "the default" a fact rather than a guess.
 */
const CREDENTIALS = {
  email: process.env["SEED_SUPER_ADMIN_EMAIL"] ?? "admin@machxi.local",
  password: process.env["SEED_SUPER_ADMIN_PASSWORD"] ?? "ChangeMe123!local",
};

/**
 * Signs in and waits for the shell.
 *
 * The wait is on the dashboard heading rather than on a URL: the boot sequence
 * is `GET /auth/csrf` → `POST /auth/refresh` before anything renders
 * (ADR-0033), so an address bar that already says `/` is not yet an app.
 */
export const signIn = async (page: Page): Promise<void> => {
  await page.goto("/login");

  await page.getByLabel("Email").fill(CREDENTIALS.email);
  await page.getByLabel("Password").fill(CREDENTIALS.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(
    page.getByRole("heading", { name: "Dashboard", level: 1 }),
  ).toBeVisible();
};

/** The two shipped grids, which every layout claim is made about twice. */
export const GRIDS = [
  { name: "Staff", path: "/staff" },
  { name: "Users", path: "/users" },
] as const;

/** The one scroll container ADR-0037 allows a grid page. */
export const scrollPane = (page: Page): Locator =>
  page.locator('[data-slot="grid-scroll"]');

export const grid = (page: Page): Locator => page.getByRole("table");

/** The static footer of ADR-0037's budget, by its landmark name. */
export const pager = (page: Page): Locator =>
  page.getByRole("navigation", { name: "Pagination" });

/** Waits for a grid to have rendered rows — never asserting how many. */
export const waitForRows = async (page: Page): Promise<void> => {
  await expect(page.locator("tbody tr").first()).toBeVisible();
};
