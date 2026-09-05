import type { Locale } from "@repo/contracts";

import enAccount from "./locales/en/account.json";
import enAuth from "./locales/en/auth.json";
import enCommon from "./locales/en/common.json";
import enErrors from "./locales/en/errors.json";
import enHome from "./locales/en/home.json";
import enImpersonation from "./locales/en/impersonation.json";
import enOrganizations from "./locales/en/organizations.json";
import enProfile from "./locales/en/profile.json";
import enSettings from "./locales/en/settings.json";
import type { Namespace } from "./namespaces";

/**
 * The eagerly bundled `en` catalogue (ADR-0046 §3).
 *
 * `en` is bundled because it is three things at once: the fallback for every
 * other locale, the type source `types.d.ts` merges over, and the locale the
 * suite runs in. Every other locale is one dynamic `import()` per namespace.
 */
export const EN_RESOURCES = {
  common: enCommon,
  errors: enErrors,
  auth: enAuth,
  home: enHome,
  account: enAccount,
  profile: enProfile,
  settings: enSettings,
  impersonation: enImpersonation,
  organizations: enOrganizations,
} as const;

/**
 * Namespaces the instance loads but this app does not own (ADR-0046 §13).
 *
 * **`"form"` since `D12.6`**, which is the one-line change the `never` at
 * `D12.1` was declared to make. `@repo/form` declares its own namespace, ships
 * its catalogues and hands them over; the name stays in {@link NAMESPACES}
 * because `init` must load it, so the two lists are no longer the same list —
 * and this type is what keeps that difference checked rather than implied.
 *
 * Still no `"grid"`, and it is the admin's other member: ADR-0055 §3 keeps
 * `@repo/grid` out of this app until a domain entity arrives.
 */
export type PackageNamespace = "form";

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
