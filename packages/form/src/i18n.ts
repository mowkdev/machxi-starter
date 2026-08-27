import { createRegister, type Register } from "@repo/i18n";

import en from "./locales/en.json";

/**
 * The form machinery's own namespace (`D9.5`, ADR-0046 §13, ADR-0051).
 *
 * The second package to declare one, and it follows `@repo/grid`'s shape
 * exactly: `ResourceNamespaceMap` rather than `CustomTypeOptions.resources`,
 * because the latter is the app's and a second declarer would collide on it
 * (TS2717) — which is the failure ADR-0046 §13's D7.1 amendment predicted for
 * precisely this step.
 *
 * The catalogue is the one that shipped under the admin's
 * `shared/i18n/locales/<locale>/form.json`, moved whole, plus one key that
 * came from that app's `common`: `actions.cancel`, the label on the button
 * `AppFormActions` renders. Unlike the three the grid took, the admin keeps
 * its own `actions.cancel` — `ConfirmDialog` renders one and no form does — so
 * this is two owners of one English word rather than a key that moved. That is
 * what §13's rule buys: a package's copy travels with the package, and the app
 * whose dialog says "Cancel" is free to say it differently.
 */
declare module "i18next" {
  interface ResourceNamespaceMap {
    form: typeof en;
  }
}

export const FORM_NAMESPACE = "form";

/**
 * The source-locale catalogue, for an app that composes at `init` (`D9.5`).
 *
 * Composing rather than registering is ADR-0051 §Strings as amended at `D9.4`:
 * `addResourceBundle` on a live instance makes i18next emit and react-i18next
 * re-render every bound component, and during an asynchronous gesture that
 * re-render lands between a click and its assertion. {@link register} stays
 * for a consumer that genuinely learns of a namespace later.
 */
export const bundles = { en };

/**
 * Every other locale, one chunk each (`D9.5`, ADR-0046 §3).
 *
 * The specifier is relative to **this** module, which is why the loader ships
 * beside the catalogues rather than being written by each consuming app —
 * `D9.2`'s lesson, and `D9.4`'s corollary: an app whose own lazy loader
 * reached for a namespace a package owns would reject the import and leave the
 * namespace half-loaded.
 */
export const loadCatalogue = async (language: string): Promise<object> => {
  const catalogue: unknown = await import(`./locales/${language}.json`);

  return catalogue as object;
};

export const register: Register = createRegister(FORM_NAMESPACE, bundles);
