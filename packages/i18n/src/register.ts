import type { Locale } from "@repo/contracts";

import type { I18n } from "./create-i18n";

/**
 * §13's `register(i18n)`, given a shape (`D9.2`, ADR-0046 §13, ADR-0051).
 *
 * **The rule it encodes**: a package that ships operator-facing strings
 * *declares* a namespace and never owns an app's dictionary. It augments
 * i18next's `ResourceNamespaceMap` with its own namespace — not
 * `CustomTypeOptions.resources`, which is the app's and would collide
 * (TS2717) the moment a second package declared one — and it exports a
 * `register` that adds its bundles to whatever instance it is handed. Each app
 * composes its own bundle by calling every package's `register` on the
 * instance it just built.
 *
 * `apps/admin/src/test/render.tsx` has been running this in miniature since
 * `D7.4`, when the demo fixture became the first declarer; this is the same
 * motion with a name and a type.
 *
 * **`@repo/i18n` itself declares no namespace**, which is why this file is a
 * mechanism and not a use of one: the factory has no operator-facing copy. The
 * first real declarers are the packages this deliverable extracts after it —
 * the grid's chrome and the form's validation copy.
 */

/** One package's namespace, per locale. Absent locales fall back per §5. */
export type NamespaceBundles = Readonly<Partial<Record<Locale, object>>>;

/**
 * What a string-shipping package exports so an app can compose it in.
 *
 * Deliberately returns `void` and takes the whole {@link I18n}: registering is
 * a side effect on a live instance, and a package that wanted to read the
 * instance back is a package doing something §13 did not license.
 */
export type Register = (i18n: I18n) => void;

/**
 * Builds a package's `register` from its namespace name and its bundles.
 *
 * `addResourceBundle` rather than an `init`-time merge, because the instance
 * already exists by the time an app composes: the app builds it from its own
 * catalogues (which is what makes the first paint synchronous, ADR-0046 §14)
 * and then adds each package's namespace to it.
 *
 * Non-destructive on purpose — the two trailing flags are i18next's `deep` and
 * `overwrite`, and this passes `deep: true, overwrite: false` so a package
 * cannot silently replace an app's override of one of its keys, and adds its
 * siblings beside that override rather than replacing the branch.
 */
export const createRegister =
  (namespace: string, bundles: NamespaceBundles): Register =>
  (i18n) => {
    for (const [locale, bundle] of Object.entries(bundles)) {
      i18n.instance.addResourceBundle(locale, namespace, bundle, true, false);
    }
  };
