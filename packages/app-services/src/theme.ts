import { DEFAULT_THEME, THEMES, type Theme } from "@repo/contracts";

/*
 * How the panel is painted, as three pure functions (ADR-0031, ADR-0045).
 *
 * Dark mode is the class strategy: this module only decides *when* the `dark`
 * class is on `<html>`; every colour it selects lives in the design system's
 * stylesheet. The preference is display state, not a credential — ADR-0033's
 * "never `localStorage`" rule is about session tokens, and its D3.1 amendment
 * carves out exactly this, with the theme as the named precedent.
 *
 * **Moved here from `app/providers/theme.ts` by `D6.3`.** ADR-0032's tree puts
 * the theme *provider* in `app/providers`, and it still is — `SettingsProvider`
 * renders it. What moved is the pure half, for the rule ADR-0032 states in the
 * same breath: a thing two layers need lives in `shared`, never beside its
 * provider. `features/theme` toggles the theme and `widgets/app-sidebar` hosts
 * the control, and neither may import from `app`; the same call `D3.4` made for
 * `useApiClient`.
 *
 * `main.tsx` still applies the stored preference before the first paint, and
 * that is the whole reason the local key survives an account-backed setting:
 * before ADR-0033's bootstrap settles there is no session to ask, and a login
 * screen that flashes light before the operator's dark arrives is the defect
 * the pre-paint apply exists to prevent (ADR-0045 §Alternatives).
 */

/**
 * The tuple comes from `@repo/contracts` now (ADR-0023, ADR-0045).
 *
 * This module used to declare its own `["light", "dark"]`, which was correct
 * while the theme was a device fact and is a second declaration of one set the
 * moment it goes on the wire — the drift ADR-0023 exists to prevent. It also
 * grew a third member on the way: `"system"` is not a third palette, it is the
 * deferral to `prefers-color-scheme`, resolved here at apply time.
 */
export type { Theme };

/** The local cache's key. Unchanged, so a stored preference survives `D6.3`. */
const STORAGE_KEY = "machxi.admin.theme";

const isTheme = (value: unknown): value is Theme =>
  THEMES.includes(value as Theme);

/**
 * Guarded, like ADR-0041's adapter and for the same reason: `localStorage`
 * throws on quota and is absent or poisoned in some private modes, and a
 * display preference that cannot be read must degrade to the default rather
 * than to a blank app — this runs before the first paint, so an exception here
 * is the whole panel.
 */
export const readStoredTheme = (): Theme | null => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);

    return isTheme(stored) ? stored : null;
  } catch {
    return null;
  }
};

/**
 * What to apply before anything has been asked.
 *
 * `DEFAULT_THEME` is `"system"`, which {@link resolveTheme} answers with the
 * media query — so a visitor with nothing stored gets exactly the behaviour
 * this function had when it consulted `prefers-color-scheme` itself.
 */
export const preferredTheme = (): Theme => readStoredTheme() ?? DEFAULT_THEME;

export const prefersDark = (): boolean =>
  window.matchMedia("(prefers-color-scheme: dark)").matches;

/** `"system"` is the media query, resolved at apply time and never stored. */
export const resolveTheme = (theme: Theme): "light" | "dark" =>
  theme === "system" ? (prefersDark() ? "dark" : "light") : theme;

/**
 * The class on `<html>` and the local cache, written together.
 *
 * The cache write is not redundant with the account setting: it is what themes
 * the next first paint and the signed-out app, both of which happen before
 * there is a session to ask. The account is written separately, by the
 * coalescing writer of ADR-0045, and only when there is one.
 */
export const applyTheme = (theme: Theme): void => {
  document.documentElement.classList.toggle(
    "dark",
    resolveTheme(theme) === "dark",
  );

  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* not persisting is an acceptable outcome; an unpainted app is not */
  }
};
