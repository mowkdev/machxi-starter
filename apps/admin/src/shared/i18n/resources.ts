import type { Locale } from "@repo/contracts";

import enAccount from "./locales/en/account.json";
import enAuth from "./locales/en/auth.json";
import enCommon from "./locales/en/common.json";
import enDashboard from "./locales/en/dashboard.json";
import enErrors from "./locales/en/errors.json";
import enProfile from "./locales/en/profile.json";
import enSettings from "./locales/en/settings.json";
import enStaff from "./locales/en/staff.json";
import enUsers from "./locales/en/users.json";
import type { Namespace } from "./namespaces";

/**
 * The eagerly bundled `en` catalogue (ADR-0046 §3).
 *
 * `en` is bundled because it is three things at once: the fallback for every
 * other locale, the type source `types.d.ts` merges over, and the locale the
 * suite runs in. Every other locale is one dynamic `import()` per namespace.
 *
 * **Its own module since `D7.4`.** `keys.ts` reads it — the deferred translator
 * of ADR-0034's global handler needs an English answer before any instance
 * exists — and `index.ts` re-exports `keys.ts`, so leaving the catalogue in the
 * barrel would have made the two a cycle. The same move `tags.ts` made at
 * `D7.2`, for the same reason.
 */
export const EN_RESOURCES = {
  common: enCommon,
  errors: enErrors,
  auth: enAuth,
  dashboard: enDashboard,
  profile: enProfile,
  staff: enStaff,
  users: enUsers,
  settings: enSettings,
  account: enAccount,
} as const;

/**
 * Namespaces the instance loads but this app does not own (`D9.4`, `D9.5`,
 * ADR-0046 §13).
 *
 * `grid` is `@repo/grid`'s and `form` is `@repo/form`'s: each package declares
 * its namespace, ships its catalogues and hands them over. The names are still
 * in {@link NAMESPACES} because `init` must load them, so the two lists are no
 * longer the same list — and this type is what keeps that difference checked
 * rather than implied.
 */
export type PackageNamespace = "grid" | "form";

/** The namespaces whose words are this app's, and whose catalogues it ships. */
export type AppNamespace = Exclude<Namespace, PackageNamespace>;

export type Catalogue = Readonly<Record<AppNamespace, object>>;

/**
 * At least `en`, and any other locale a caller wants in memory before the
 * first render. Production hands only `en` and lets the lazy backend fetch the
 * rest; the test harness hands every locale, which is what keeps `test:unit`
 * synchronous and cached (ADR-0046 §14).
 */
export type Catalogues = Readonly<Partial<Record<Locale, Catalogue>>> & {
  readonly en: Catalogue;
};
