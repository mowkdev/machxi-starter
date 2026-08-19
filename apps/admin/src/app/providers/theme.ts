/*
 * Dark mode is the class strategy (ADR-0031): this file only decides *when* the
 * `dark` class is on `<html>`; every colour it selects lives in the design
 * system's stylesheet. The preference is a display setting, not a credential —
 * ADR-0033's "never `localStorage`" rule is about session tokens, and nothing
 * here is one.
 *
 * It sits in `app/providers/` with the rest of the app's wiring, which is
 * where ADR-0032's tree puts the theme. `main.tsx` applies the stored
 * preference before the first paint; a provider with a toggle in the dashboard
 * shell is `D3.9`'s to add, once there is a header to put it in.
 */

export const THEMES = ["light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = "machxi.admin.theme";

const isTheme = (value: unknown): value is Theme =>
  THEMES.includes(value as Theme);

export const readStoredTheme = (): Theme | null => {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isTheme(stored) ? stored : null;
};

export const preferredTheme = (): Theme =>
  readStoredTheme() ??
  (window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light");

export const applyTheme = (theme: Theme) => {
  document.documentElement.classList.toggle("dark", theme === "dark");
  window.localStorage.setItem(STORAGE_KEY, theme);
};
