/**
 * The door onto `@repo/app-services`' theme (ADR-0051).
 *
 * ADR-0045 §Theme unchanged, and ADR-0049's reason this lives in `shared`
 * rather than beside the provider that configures it: a preferences control
 * toggles it and a widget hosts it, and neither may import from `app`.
 *
 * **The `localStorage` key is a parameter now, and this door is what binds it**
 * (`D14.7`, ADR-0064 §1). At `D12.1` the key was the package's constant
 * `machxi.admin.theme` in *both* apps — the name `D9.6` deliberately did not
 * parameterise, on the argument that the key is per-origin and the two SPAs are
 * two origins. `D12.1` was named as the test of whether it would read wrong in
 * a second app, and it did: a customer's devtools said `admin`, and on a single
 * origin the two apps shared a theme outright. That was D12's finding 1, and it
 * is closed here by the mechanism rather than by a special case — the prefix is
 * `${appId}.${segment}`, so this app writes `machxi.user.theme`.
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
