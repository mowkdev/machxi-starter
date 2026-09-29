import { createSettingsProvider } from "@/entities/settings";
import { I18nProvider } from "@/shared/i18n";
import { ThemeProvider } from "@/shared/theme";

import {
  PrincipalCacheBoundary,
  usePrincipalCacheOwner,
} from "./principal-cache";

/**
 * The account's settings gate, bound to this app (`D12.7`; ADR-0045 §The
 * client as carried by ADR-0053; the gate itself is `@repo/account`'s since
 * `D22.2`, ADR-0077 §2).
 *
 * `app` is wiring (ADR-0049), and this is where four things that live in four
 * places are joined: the gate from `entities/settings`, the theme provider
 * with this app's device-key prefix, the i18n provider built over this app's
 * dictionary, and the principal-cache boundary keyed the way this app keys it.
 *
 * **No grid preference adapter is passed**, which is the one difference from
 * the admin's binding: ADR-0055 §3 keeps `@repo/grid` out of this app until a
 * domain entity arrives. The gate is still worth its round trip here, for the
 * locale and the density — both providers' *first* render is the one that
 * counts, and a customer whose account says Latvian would otherwise read a
 * frame of English first.
 */
export const SettingsProvider = createSettingsProvider({
  ThemeProvider,
  I18nProvider,
  PrincipalCacheBoundary,
  usePrincipalCacheOwner,
});

export type { SettingsProviderProps } from "@/entities/settings";
