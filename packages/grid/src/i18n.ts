import { createRegister, type Register } from "@repo/i18n";

import en from "./locales/en.json";

/**
 * The grid's own namespace, declared and registered (`D9.4`, ADR-0046 §13).
 *
 * **§13's first real use**, which `D9.2` built the mechanism for. The rule it
 * follows: a package that ships operator-facing strings *declares* a namespace
 * and never owns an app's dictionary. So this augments `ResourceNamespaceMap`
 * — not `CustomTypeOptions.resources`, which is the app's and would collide
 * (TS2717) the moment a second package declared one — and exports a `register`
 * each app calls on the instance it built.
 *
 * The catalogues are the ones that shipped under the admin's
 * `shared/i18n/locales/<locale>/grid.json`, moved whole. Three keys joined them from the admin's
 * `common` namespace — `actions.clear`, `actions.clearAll` and `actions.apply`
 * — because they were used by the grid and by nothing else in that app, and a
 * package reaching into an app's `common` is the borrowing §13 forbids.
 */
declare module "i18next" {
  interface ResourceNamespaceMap {
    grid: typeof en;
  }
}

export const GRID_NAMESPACE = "grid";

/**
 * The catalogues themselves, for an app that composes at `init` rather than
 * registering afterwards (`D9.4`).
 *
 * **Both shapes are offered because the timing matters.** `addResourceBundle`
 * on a live instance makes i18next emit, and react-i18next re-renders every
 * bound component when it does — harmless at rest, but during an asynchronous
 * `user-event` gesture that re-render lands between the click and its
 * assertion. An app that knows its packages up front merges these into
 * `createI18n`'s `resources` and never takes that risk; {@link register}
 * stays for a consumer that genuinely learns of a namespace later.
 */
export const bundles = { en };

/**
 * Every other locale, one chunk each (`D9.4`, ADR-0046 §3).
 *
 * **`en` is eager and the rest are not**, which is §3's rule carried into a
 * package: a Latvian operator downloads Latvian and an English one downloads
 * nothing extra. Only the source locale needs to be present at `init` — that
 * is what makes the first paint synchronous and what the init-time composition
 * above exists for; a second locale is a navigation away and can be fetched.
 *
 * The specifier is relative to **this** module, which is why the loader ships
 * with the catalogues rather than being written by each consuming app —
 * `D9.2`'s lesson, applied before it could bite a second time.
 */
export const loadCatalogue = async (language: string): Promise<object> => {
  const catalogue: unknown = await import(`./locales/${language}.json`);

  return catalogue as object;
};

export const register: Register = createRegister(GRID_NAMESPACE, bundles);
