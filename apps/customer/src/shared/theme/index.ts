/**
 * The door onto `@repo/app-services`' theme (ADR-0051).
 *
 * ADR-0045 §Theme unchanged, and ADR-0049's reason this lives in `shared`
 * rather than beside the provider that configures it: a preferences control
 * toggles it and a widget hosts it, and neither may import from `app`.
 *
 * At `D12.1` the one consumer is `main.tsx`'s pre-paint apply, so a device that
 * prefers dark gets the login screen in dark rather than a flash of light.
 * `ThemeProvider` and `useTheme` are re-exported with it because the harness
 * mounts the provider from the first render, and the account's own control
 * arrives at `D12.7`.
 *
 * **The `localStorage` key is the package's, and it reads `machxi.admin.theme`
 * in both apps** — the name `D9.6` deliberately did not parameterise, on the
 * argument that the key is per-origin and the two SPAs are two origins.
 * `D12.1` is the step that was named as the test of whether it *reads* wrong in
 * a second app, and it does: nothing breaks, and the string in a customer's
 * devtools says `admin`. Recorded as a finding in the plan rather than fixed
 * here — it is `@repo/i18n`'s and `@repo/app-services`' one parameter each, and
 * the deliverable's rule is that a package diff is named before it is made.
 */
export {
  ThemeProvider,
  applyTheme,
  preferredTheme,
  prefersDark,
  readStoredTheme,
  resolveTheme,
  useTheme,
  type Theme,
  type ThemeProviderProps,
  type ThemeView,
} from "@repo/app-services";
