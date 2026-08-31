import type { Locale } from "@repo/contracts";

import enAuth from "./locales/en/auth.json";
import enCommon from "./locales/en/common.json";
import enErrors from "./locales/en/errors.json";
import enHome from "./locales/en/home.json";
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
} as const;

/**
 * Namespaces the instance loads but this app does not own (ADR-0046 §13).
 *
 * **Empty at `D12.1` and typed as `never`, deliberately.** The admin's is
 * `"grid" | "form"`; this app depends on neither package yet — ADR-0055 §3
 * keeps `@repo/grid` out until a domain entity arrives — so {@link Namespace}
 * and {@link AppNamespace} are the same union today. The type is declared
 * anyway because `D12.6` adds `form` to it, and a `never` here is what makes
 * that a one-line change rather than a new concept.
 */
export type PackageNamespace = never;

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
