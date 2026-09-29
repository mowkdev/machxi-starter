import { createRegister, type Register } from "@repo/i18n";

import en from "./locales/en.json";

/**
 * The account package's own namespace (`D22.2`, ADR-0077 §2, ADR-0046 §13).
 *
 * The third package to declare one, in `@repo/form`'s shape:
 * `ResourceNamespaceMap` rather than `CustomTypeOptions.resources`, which is
 * the app's and which a second declarer would collide on.
 *
 * **`accountClient`, not `account`.** Both apps already own an `account`
 * namespace — `pages/account`'s title and section labels — and a namespace has
 * one owner.
 *
 * **What is here is the copy both apps wrote identically**, in both locales,
 * measured key by key before it moved. A sentence the two apps word
 * differently — the password dialog's description speaks of "sessions" to an
 * operator and "devices" to a customer — stays in each app's catalogue and
 * arrives as a key the door passes, because a difference that is a value is
 * what a door binds.
 */
declare module "i18next" {
  interface ResourceNamespaceMap {
    accountClient: typeof en;
  }
}

export const ACCOUNT_NAMESPACE = "accountClient";

/** The source-locale catalogue, for an app that composes at `init`. */
export const bundles = { en };

/**
 * Every other locale, one chunk each (ADR-0046 §3).
 *
 * The specifier is relative to **this** module, which is why the loader ships
 * beside the catalogues rather than being written by each consuming app.
 */
export const loadCatalogue = async (language: string): Promise<object> => {
  const catalogue: unknown = await import(`./locales/${language}.json`);

  return catalogue as object;
};

export const register: Register = createRegister(ACCOUNT_NAMESPACE, bundles);
