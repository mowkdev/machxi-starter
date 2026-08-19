/*
 * Dark mode is the class strategy (ADR-0031): this file only decides *when* the
 * `dark` class is on `<html>`; every colour it selects lives in the design
 * system's stylesheet. The preference is a display setting, not a credential —
 * ADR-0033's "never `localStorage`" rule is about session tokens, and nothing
 * here is one.
 *
 * `D3.3` moves this behind `app/providers/` with the rest of the app wiring
 * (ADR-0032); it lives here so `D3.1` can prove the tokens flip.
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
