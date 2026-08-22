import { afterEach, describe, expect, it } from "vitest";

import {
  createI18n,
  EN_RESOURCES,
  INTL_TAGS,
  LOCALE_STORAGE_KEY,
  NAMESPACES,
  preferredLocale,
} from "..";

/**
 * The factory (ADR-0046 §5, §13).
 *
 * Three claims are worth an assertion at `D7.1`, before there is any copy to
 * translate and while the catalogues are empty: that `en` initialises
 * **synchronously**, which is what keeps the whole suite a pure function of
 * the tree and therefore cached (ADR-0026, ADR-0046 §14); that `<html lang>`
 * carries the Intl tag and follows a change; and that two instances are
 * genuinely independent, which is the property the "factory, not a singleton"
 * rule exists for and the one a later step would otherwise discover through a
 * test that fails only when run second.
 */

const build = (locale: "en" | "lv" = "en") =>
  createI18n({
    resources: { en: EN_RESOURCES },
    namespaces: NAMESPACES,
    locale,
  });

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("lang");
});

describe("createI18n", () => {
  it("initialises synchronously at en, with no awaiting", () => {
    const i18n = build();

    // Not `await`ed anywhere above: the eager catalogue is in the bundle, and
    // `initAsync: false` is what makes the instance usable on the line after
    // it is built.
    expect(i18n.instance.isInitialized).toBe(true);
    expect(i18n.instance.language).toBe("en");
  });

  it("sets <html lang> to the Intl tag rather than the enum member", () => {
    build();

    // `en` means en-GB here (ADR-0046 §5) — the tag is what a screen reader
    // picks a voice from and what a browser hyphenates by, so it is the more
    // truthful of the two answers.
    expect(document.documentElement.lang).toBe(INTL_TAGS.en);
    expect(document.documentElement.lang).toBe("en-GB");
  });

  it("follows the language on a change, in the document and in the cache", async () => {
    const i18n = build();

    await i18n.changeLocale("lv");

    expect(document.documentElement.lang).toBe("lv-LV");
    // The device cache, which is what answers before the next sign-in has a
    // session to ask (ADR-0046 §4, ADR-0033's D3.1 carve-out).
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("lv");
    expect(i18n.instance.language).toBe("lv");
  });

  it("answers a key no catalogue has with the key, never with null", () => {
    const i18n = build();

    /*
     * The catalogues are empty at `D7.1`, so *every* key is missing — which
     * makes this the cheapest possible check that `returnNull: false` holds: a
     * key the bundle has never heard of renders its own name, and nothing
     * downstream has to defend against a null.
     *
     * The cast is the typed-key rule working rather than a hole in it: the
     * declaration merge in `types.d.ts` makes an unknown key a **compile**
     * error, so the only way to ask what happens at runtime is to leave the
     * type system deliberately, in one place, saying why.
     */
    const t = i18n.instance.t as (key: string) => string;

    // The namespace prefix is consumed by the lookup, so what comes back is
    // the key *within* its namespace — which is worth pinning rather than
    // assuming, because `D7.6`'s pseudo-locale suite reads rendered text and a
    // missing key has to be recognisable on sight.
    expect(t("common:nothing.here.yet")).toBe("nothing.here.yet");
  });

  it("gives out independent instances, not a shared singleton", async () => {
    const first = build();
    const second = build();

    await first.changeLocale("lv");

    expect(first.instance.language).toBe("lv");
    // The reason ADR-0009's `create*` rule was carried across the wire: a
    // suite that shared one instance would have files passing or failing by
    // the order they ran in.
    expect(second.instance.language).toBe("en");
  });
});

describe("preferredLocale", () => {
  it("prefers the account over the device", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "en");

    expect(preferredLocale("lv")).toBe("lv");
  });

  it("reads the device cache when there is no account", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "lv");

    expect(preferredLocale()).toBe("lv");
  });

  it("survives a localStorage that refuses to answer", () => {
    const getItem = window.localStorage.getItem;

    window.localStorage.getItem = () => {
      throw new Error("denied");
    };

    try {
      // jsdom's navigator reports an English list, and the point is that the
      // throw is absorbed rather than what it falls through to.
      expect(preferredLocale()).toBe("en");
    } finally {
      window.localStorage.getItem = getItem;
    }
  });
});
