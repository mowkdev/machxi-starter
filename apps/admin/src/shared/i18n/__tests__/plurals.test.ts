import { afterEach, describe, expect, it } from "vitest";

import { createI18n, EN_RESOURCES, NAMESPACES, type I18n } from "..";

/**
 * The plural categories, per locale and per category (ADR-0046 §1, §11, §14).
 *
 * This is the assertion the whole Latvian argument rests on. The plan chose `lv`
 * as the second locale because it has **three** CLDR categories where English has
 * two — `0 ierakstu`, `1 ieraksts`, `2 ieraksti`, `11 ierakstu`, `21 ieraksts` —
 * and a layer that gets Latvian counts right gets most of Europe right. A single
 * case per key would pass while being wrong: `1`, `2` and `24` all read correctly
 * under a map that looked only at the ones digit, and `11` and `12` are where
 * that map breaks.
 *
 * It is driven through a **real instance** rather than through `Intl.PluralRules`
 * directly, because the claim is about the catalogue and not about the platform:
 * what fails a missing `_zero` key is i18next resolving a category that has no
 * entry and quietly falling back, which is exactly the shape of bug a Latvian
 * reader would report as "it says the wrong word sometimes".
 *
 * ADR-0046 §5 and §14: the zod map and the `Intl` holder are app-wide, so a file
 * that switches the locale restores `en` before it finishes.
 */

const build = (): I18n =>
  createI18n({
    resources: { en: EN_RESOURCES },
    namespaces: NAMESPACES,
    locale: "en",
  });

/**
 * Latvian, by CLDR: `zero` for a multiple of ten and for the whole 11–19 band,
 * `one` for anything ending in 1 that is not 11, `other` for the rest.
 */
const LATVIAN_CATEGORIES: readonly (readonly [number, string])[] = [
  [0, "zero"],
  [1, "one"],
  [2, "other"],
  [10, "zero"],
  [11, "zero"],
  [12, "zero"],
  [19, "zero"],
  [20, "zero"],
  [21, "one"],
  [22, "other"],
  [101, "one"],
  [111, "zero"],
];

/** English, for contrast: `one` is `1` and nothing else, `0` included. */
const ENGLISH_CATEGORIES: readonly (readonly [number, string])[] = [
  [0, "other"],
  [1, "one"],
  [2, "other"],
  [11, "other"],
  [21, "other"],
];

let active: I18n | null = null;

afterEach(async () => {
  await active?.changeLocale("en");
  active = null;
  window.localStorage.clear();
});

describe("plural categories", () => {
  it("resolves Latvian's three forms where English has two", async () => {
    const i18n = build();

    active = i18n;

    const englishForms: Record<string, string> = {
      one: "{{count}} filter applied",
      other: "{{count}} filters applied",
    };

    for (const [count, category] of ENGLISH_CATEGORIES)
      expect(i18n.instance.t("grid:applied.announce", { count })).toBe(
        englishForms[category]?.replace("{{count}}", String(count)),
      );

    await i18n.changeLocale("lv");

    const latvianForms: Record<string, string> = {
      zero: "Lietoti {{count}} filtru",
      one: "Lietots {{count}} filtrs",
      other: "Lietoti {{count}} filtri",
    };

    for (const [count, category] of LATVIAN_CATEGORIES)
      expect(i18n.instance.t("grid:applied.announce", { count })).toBe(
        latvianForms[category]?.replace("{{count}}", String(count)),
      );
  });

  it("declines the bulk summary's noun with the same count as its sentence", async () => {
    const i18n = build();

    active = i18n;

    await i18n.changeLocale("lv");

    /*
     * `D7.4` closed the half `D7.2` left open: the noun is a key with its own
     * categories, resolved with the count that pluralised the sentence around
     * it. Latvian is the language that proves it — `1 darbinieka konts`,
     * `2 darbinieku konti`, `11 darbinieku kontu` are three different words for
     * one noun, and an English singular handed in as a string could be none of
     * them.
     */
    const summary = (count: number): string =>
      i18n.instance.t("grid:bulk.deleted", {
        count,
        noun: i18n.instance.t("staff:noun", { count }),
      });

    expect(summary(1)).toBe("Dzēsts 1 darbinieka konts.");
    expect(summary(2)).toBe("Dzēsti 2 darbinieku konti.");
    expect(summary(11)).toBe("Dzēsti 11 darbinieku kontu.");
    expect(summary(0)).toBe("Dzēsti 0 darbinieku kontu.");
  });

  it("keeps English at two forms, so nothing about the source locale moved", () => {
    const i18n = build();

    active = i18n;

    expect(i18n.instance.t("grid:applied.announce", { count: 1 })).toBe(
      "1 filter applied",
    );
    expect(i18n.instance.t("grid:applied.announce", { count: 0 })).toBe(
      "0 filters applied",
    );
    expect(i18n.instance.t("grid:bulk.deleted", { count: 2, noun: "x" })).toBe(
      "2 x deleted.",
    );
  });
});
