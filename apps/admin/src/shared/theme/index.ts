/**
 * The door onto `@repo/app-services`' theme (`D9.6`, ADR-0051).
 *
 * The pure half and the provider both moved; the import path every feature and
 * widget writes did not. `ADR-0045 §Theme` is unchanged and so is ADR-0032's
 * reason this lives in `shared` rather than beside the provider that
 * configures it: `features/theme` toggles the theme and `widgets/app-sidebar`
 * hosts the control, and neither may import from `app`.
 *
 * **The `localStorage` key is a parameter now, and this door is what binds it**
 * (`D14.7`, ADR-0064 §1). `D9.6` left it the constant `machxi.admin.theme` on
 * the argument that "the key is per-origin and the two SPAs are two origins",
 * and named `D12.1` as the test of whether the *name* would read wrong in a
 * second app. It did — and two SPAs deployed on one origin do not merely read
 * wrong, they share one operator's and one customer's theme. The prefix is
 * `${appId}.${segment}`, so this app still writes `machxi.admin.theme` while
 * `apps/customer` writes its own, and the package holds no brand at all.
 */

import {
  applyTheme as applyThemeFor,
  preferredTheme as preferredThemeFor,
  prefersDark,
  readStoredTheme as readStoredThemeFor,
  resolveTheme,
  useTheme,
  type Theme,
  type ThemeView,
} from "@repo/app-services";

import { DEVICE_KEY_PREFIX } from "@/shared/config";

export { prefersDark, resolveTheme, useTheme, type Theme, type ThemeView };
export { ThemeProvider, type ThemeProviderProps } from "./provider";

/*
 * The three pure functions, bound to this app's device-key prefix.
 *
 * Every call site above this door is untouched by the parameter, which is the
 * door's whole job in both directions: a slice never names a key, and a fork's
 * brand never reaches a package the starter also edits.
 */
export const readStoredTheme = (): Theme | null =>
  readStoredThemeFor(DEVICE_KEY_PREFIX);

export const preferredTheme = (): Theme => preferredThemeFor(DEVICE_KEY_PREFIX);

export const applyTheme = (theme: Theme): void => {
  applyThemeFor(DEVICE_KEY_PREFIX, theme);
};
