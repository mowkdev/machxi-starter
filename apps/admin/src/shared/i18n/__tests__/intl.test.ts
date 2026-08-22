import { afterEach, describe, expect, it } from "vitest";

import {
  activeIntlTag,
  createI18n,
  dateTimeFormat,
  EN_RESOURCES,
  INTL_TAGS,
  NAMESPACES,
  setIntlLocale,
} from "..";

/**
 * The formatters follow the app's locale, not the browser's (ADR-0046 §5,
 * `D7.2`).
 *
 * The defect this closes is quiet and would have survived a Latvian review:
 * `new Intl.DateTimeFormat(undefined, …)` reads *the machine's* language, so an
 * operator who chose Latvian on an English laptop would have read Latvian
 * column headers over English dates, and the screen would have looked
 * translated. Nothing in a class list or a snapshot says which locale a
 * formatter was built with; only an assertion does.
 */

afterEach(() => {
  setIntlLocale("en");
  window.localStorage.clear();
  document.documentElement.removeAttribute("lang");
});

const JANUARY = new Date("2026-01-15T10:00:00.000Z");

describe("the active Intl tag", () => {
  it("starts at the source language's tag, which is en-GB and not en", () => {
    // §5's decision, reachable from code rather than only from prose: `en`
    // *means* British English here — European date order and British spelling
    // — so a formatter that resolved bare `en` would put the month first.
    expect(activeIntlTag()).toBe(INTL_TAGS.en);
    expect(dateTimeFormat({ dateStyle: "medium" }).format(JANUARY)).toBe(
      "15 Jan 2026",
    );
  });

  it("moves with the locale, and formats in it", () => {
    setIntlLocale("lv");

    expect(activeIntlTag()).toBe("lv-LV");

    const formatted = dateTimeFormat({ dateStyle: "medium" }).format(JANUARY);

    /*
     * The exact Latvian rendering is CLDR's and belongs to the platform, not to
     * this repository — pinning it would make the suite fail on an ICU upgrade
     * that improved the answer. What is ours is that the *tag* reached `Intl`,
     * which the difference from the British form proves.
     */
    expect(formatted).not.toBe("15 Jan 2026");
    expect(formatted).toContain("2026");
  });

  it("hands back the same formatter for the same options and locale", () => {
    const options: Intl.DateTimeFormatOptions = { dateStyle: "medium" };

    // A grid builds one per cell otherwise, and `Intl.DateTimeFormat` is the
    // expensive constructor in this file.
    expect(dateTimeFormat(options)).toBe(dateTimeFormat(options));
  });

  it("discards the cache when the locale moves, rather than serving a stale one", () => {
    const options: Intl.DateTimeFormatOptions = { dateStyle: "long" };
    const british = dateTimeFormat(options);

    setIntlLocale("lv");

    // The bug this guards is a cache keyed on options alone: every date on
    // screen would keep the language it was first rendered in.
    expect(dateTimeFormat(options)).not.toBe(british);
    expect(dateTimeFormat(options).resolvedOptions().locale).toContain("lv");
  });
});

describe("createI18n", () => {
  it("swaps the Intl tag as part of changing language", async () => {
    /*
     * The wiring, not the holder: `applyLocale` sets the tag *inside* the
     * `languageChanged` listener that `createI18n` subscribes before
     * `initReactI18next`, so the formatters have already moved by the time
     * react-i18next asks the tree to render. Without this a locale switch would
     * repaint the copy and leave every date a render behind.
     */
    const i18n = createI18n({
      resources: { en: EN_RESOURCES },
      namespaces: NAMESPACES,
      locale: "en",
    });

    expect(activeIntlTag()).toBe("en-GB");

    await i18n.changeLocale("lv");

    expect(activeIntlTag()).toBe("lv-LV");
  });
});
