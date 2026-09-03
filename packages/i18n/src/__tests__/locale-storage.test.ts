import { afterEach, describe, expect, it } from "vitest";

import {
  localeStorageKey,
  readStoredLocale,
  writeStoredLocale,
} from "../locale-storage";

/**
 * The locale's device cache, keyed by the prefix the app supplies
 * (ADR-0064 §1, ADR-0046 §4).
 *
 * The same shape and the same reason as the theme's: until `D14.7` this module
 * held the constant `machxi.admin.locale`, so a customer app on one origin
 * with the admin panel read and wrote an operator's language. The prefixes
 * below are the ones the two apps really build from
 * `${VITE_APP_ID}.${segment}`.
 */

const ADMIN = "machxi.admin";
const CUSTOMER = "machxi.user";

afterEach(() => {
  window.localStorage.clear();
});

describe("the locale's device key", () => {
  it("is the app's prefix plus the fact", () => {
    expect(localeStorageKey(ADMIN)).toBe("machxi.admin.locale");
    expect(localeStorageKey(CUSTOMER)).toBe("machxi.user.locale");
  });

  it("gives the two apps different entries for the same fact", () => {
    writeStoredLocale(ADMIN, "en");
    writeStoredLocale(CUSTOMER, "lv");

    expect(readStoredLocale(ADMIN)).toBe("en");
    expect(readStoredLocale(CUSTOMER)).toBe("lv");
  });

  it("reads nothing across the two prefixes", () => {
    writeStoredLocale(CUSTOMER, "lv");

    // `null` rather than `"lv"`: an app with no stored locale of its own falls
    // through to the navigator, which is ADR-0046 §4's next source.
    expect(readStoredLocale(ADMIN)).toBeNull();
  });

  it("still answers null for a value that is not a locale", () => {
    // The guard ADR-0046 §4 relies on, unchanged by the prefix: a hand-edited
    // entry degrades to the next source rather than to a blank app.
    window.localStorage.setItem(localeStorageKey(ADMIN), "klingon");

    expect(readStoredLocale(ADMIN)).toBeNull();
  });
});
