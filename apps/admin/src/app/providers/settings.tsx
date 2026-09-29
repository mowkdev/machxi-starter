import { GRID_PREFERENCES, createSettingsProvider } from "@/entities/settings";
import { I18nProvider } from "@/shared/i18n";
import { ThemeProvider } from "@/shared/theme";

import {
  PrincipalCacheBoundary,
  usePrincipalCacheOwner,
} from "./principal-cache";

/**
 * The account's settings gate, bound to this app (ADR-0045 §The client; the
 * gate itself is `@repo/account`'s since `D22.2`, ADR-0077 §2).
 *
 * `app` is wiring (ADR-0049), and this is where four things that live in four
 * places are joined: the gate from `entities/settings`, the theme provider
 * with this app's device-key prefix, the i18n provider built over this app's
 * dictionary, and the principal-cache boundary keyed the way this app keys it.
 *
 * **The grid preference adapter is what this app passes and the customer app
 * does not.** ADR-0041's `read` is synchronous: a grid reads its storage once
 * at mount, so one that mounted before the writer's mirror was seeded would
 * render the device's arrangement and never hear about the account's. The
 * gate holds the app until the settings query has settled for exactly that
 * reason, and hands every grid below it the server-backed adapter.
 */
export const SettingsProvider = createSettingsProvider({
  ThemeProvider,
  I18nProvider,
  PrincipalCacheBoundary,
  usePrincipalCacheOwner,
  grids: GRID_PREFERENCES,
});

export type { SettingsProviderProps } from "@/entities/settings";
