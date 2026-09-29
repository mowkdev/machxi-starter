import type { Locale } from "@repo/contracts";
import { createI18n, type I18n, type TranslateKey } from "@repo/i18n";

import en from "../../locales/en.json";
import lv from "../../locales/lv.json";
import demo from "./demo-catalogue.json";

/**
 * The instance the moved door-level suites translate through (`D22.3`,
 * ADR-0077 §4).
 *
 * In the admin these suites built the app's own instance — ten catalogues and
 * the demo fixture's namespace — and asserted the catalogue's words rather
 * than a stub's, so that a key deleted from a catalogue failed a case instead
 * of rendering blank. What they read was only ever three things, and this
 * instance is exactly those three: the grid's own namespace, the demo
 * fixture's, and the slice of an app's `common` that `@repo/resource`'s
 * `optionLabel` resolves an enum value through.
 *
 * **`lv` is supplied eagerly for the grid alone**, which is what the locale
 * switch in `grid-locale.test.tsx` reads: the pager's Latvian over Latvian
 * dates. The demo and `common` blocks fall back to `en`, the way an
 * untranslated namespace does in an app.
 *
 * `@repo/i18n`'s factory rather than a stub, so the `t` the pure helpers are
 * handed is the kind of translator an app supplies, plural rules included.
 */

/** A device-key prefix an app would supply (ADR-0064 §1). */
export const KEY_PREFIX = "test.grid";

/**
 * The words an app's `common:options` block gives the demo's two statuses.
 *
 * English, and the admin's own words, because the moved cases assert them:
 * "Status is Active" on a chip, "Active" on a hot filter. The grid names no
 * `common:` key itself — `@repo/resource` does, with a humanised default — so
 * this is the app's half of that lookup, stood in for.
 *
 * **This half is not checked here, and it was not in the admin either** (the
 * `D22.3` review): both words are exactly what `humanize` answers, so a case
 * reading "Active" passes with this block deleted. The lookup is
 * `@repo/resource`'s to certify, and the enum cases here are about the grid's
 * phrasing around the word, not about where the word came from.
 */
const common = {
  options: { active: "Active", disabled: "Disabled" },
};

export const createTestI18n = (locale: Locale = "en"): I18n =>
  createI18n({
    resources: {
      en: { grid: en, common, demo },
      lv: { grid: lv },
    },
    storageKeyPrefix: KEY_PREFIX,
    namespaces: ["grid", "common", "demo"],
    defaultNamespace: "grid",
    locale,
  });

/** The instance's `t`, for the pure helpers that take a translator. */
export const createTranslator = (): TranslateKey =>
  createTestI18n().t as TranslateKey;
