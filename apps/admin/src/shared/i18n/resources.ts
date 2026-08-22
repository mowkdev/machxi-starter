import type { Locale } from "@repo/contracts";

import enAuth from "./locales/en/auth.json";
import enCommon from "./locales/en/common.json";
import enDashboard from "./locales/en/dashboard.json";
import enErrors from "./locales/en/errors.json";
import enForm from "./locales/en/form.json";
import enGrid from "./locales/en/grid.json";
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
  grid: enGrid,
  form: enForm,
  errors: enErrors,
  auth: enAuth,
  dashboard: enDashboard,
  profile: enProfile,
  staff: enStaff,
  users: enUsers,
  settings: enSettings,
} as const;

export type Catalogue = Readonly<Record<Namespace, object>>;

/**
 * At least `en`, and any other locale a caller wants in memory before the
 * first render. Production hands only `en` and lets the lazy backend fetch the
 * rest; the test harness hands every locale, which is what keeps `test:unit`
 * synchronous and cached (ADR-0046 §14).
 */
export type Catalogues = Readonly<Partial<Record<Locale, Catalogue>>> & {
  readonly en: Catalogue;
};
