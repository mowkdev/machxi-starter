/**
 * The door onto `@repo/app-services`' theme (`D9.6`, ADR-0051).
 *
 * The pure half and the provider both moved; the import path every feature and
 * widget writes did not. `ADR-0045 §Theme` is unchanged and so is ADR-0032's
 * reason this lives in `shared` rather than beside the provider that
 * configures it: `features/theme` toggles it and `widgets/app-sidebar` hosts
 * the control, and neither may import from `app`.
 *
 * **The `localStorage` key is the package's, and it still reads
 * `machxi.admin.theme`.** That is the shape `@repo/i18n` shipped at `D9.2` for
 * the locale, kept deliberately rather than parameterised here: the key is
 * per-origin, the two SPAs are two origins, and inventing a parameter for a
 * collision that cannot happen would be a generalisation this deliverable
 * forbids itself. D11 is the deliverable that finds out whether the *name*
 * reads wrong in a second app; it is one parameter each if so.
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
