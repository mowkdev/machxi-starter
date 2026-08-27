import { describe, expect, it } from "vitest";

import { asLocale, resolveInitialLocale } from "../resolve-locale";

/**
 * The precedence of ADR-0046 §4, as a table.
 *
 * It is the one part of i18n that is a decision rather than a mechanism —
 * settings, then the device cache, then the browser, then `en` — and it is
 * pure precisely so that it can be checked without a browser, a session or an
 * instance. The two cases worth naming out loud are the ones the record calls
 * out: `lv-LV` matches `lv` by primary subtag, and a tag that matches nothing
 * is **not guessed at**.
 */

describe("asLocale", () => {
  it("takes an exact locale", () => {
    expect(asLocale("lv")).toBe("lv");
    expect(asLocale("en")).toBe("en");
  });

  it("matches a regional tag by its primary subtag", () => {
    // A region narrows a language and cannot change it, which is the whole of
    // the matching rule.
    expect(asLocale("lv-LV")).toBe("lv");
    expect(asLocale("en-GB")).toBe("en");
    expect(asLocale("en-US")).toBe("en");
  });

  it("is case-insensitive, because navigator.languages is not normalised", () => {
    expect(asLocale("LV-lv")).toBe("lv");
  });

  it("does not guess at anything else", () => {
    // `lt` is Lithuanian, one letter and one country away from Latvian: an
    // operator can read an English fallback and cannot undo a language they do
    // not speak reaching the settings page.
    expect(asLocale("lt")).toBeNull();
    expect(asLocale("ru")).toBeNull();
    // Not a member of `LOCALES`: the pseudo-locale is a dev-only lens over
    // `en` (ADR-0046 §10), never a language an account can have.
    expect(asLocale("en-XA")).toBe("en");
    expect(asLocale("xa")).toBeNull();
    expect(asLocale("")).toBeNull();
    expect(asLocale(null)).toBeNull();
    expect(asLocale(undefined)).toBeNull();
  });
});

describe("resolveInitialLocale", () => {
  const table = [
    {
      name: "the account wins over everything, because it is the fact",
      sources: { settings: "lv", stored: "en", navigator: ["en-GB"] },
      expected: "lv",
    },
    {
      name: "the device cache answers when there is no session to ask",
      sources: { settings: null, stored: "lv", navigator: ["en-GB"] },
      expected: "lv",
    },
    {
      name: "a stored value that is no longer a locale is ignored, not trusted",
      sources: { settings: null, stored: "de", navigator: ["lv-LV"] },
      expected: "lv",
    },
    {
      name: "navigator.languages matches by primary subtag",
      sources: { settings: null, stored: null, navigator: ["lv-LV", "en-GB"] },
      expected: "lv",
    },
    {
      name: "the first navigator entry that matches wins, in the browser's order",
      sources: { settings: null, stored: null, navigator: ["lt", "en", "lv"] },
      expected: "en",
    },
    {
      name: "an unmatched browser list falls through to en rather than guessing",
      sources: { settings: null, stored: null, navigator: ["lt-LT", "ru-RU"] },
      expected: "en",
    },
    {
      name: "nothing at all is en",
      sources: { settings: null, stored: null, navigator: [] },
      expected: "en",
    },
  ] as const;

  it.each(table)("$name", ({ sources, expected }) => {
    expect(resolveInitialLocale(sources)).toBe(expected);
  });
});
