import { afterEach, describe, expect, it } from "vitest";

import { applyTheme, preferredTheme, readStoredTheme } from "../theme";

/**
 * The theme's device cache, keyed by the prefix the app supplies
 * (ADR-0064 §1, ADR-0045 §Theme).
 *
 * Two apps, one origin, and the whole point of the parameter: until `D14.7`
 * this module held the constant `machxi.admin.theme`, so an operator's panel
 * and a customer's account shared one entry — D12's finding 1. The prefixes
 * below are exactly the ones `apps/admin` and `apps/customer` build from
 * `${VITE_APP_ID}.${segment}`, so what is asserted is the deployed shape
 * rather than an invented one.
 */

const ADMIN = "machxi.admin";
const CUSTOMER = "machxi.user";

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("the theme's device key", () => {
  it("is the app's prefix plus the fact", () => {
    applyTheme(ADMIN, "dark");

    expect(window.localStorage.getItem("machxi.admin.theme")).toBe("dark");
    expect(window.localStorage.getItem("machxi.user.theme")).toBeNull();
  });

  it("gives the two apps different entries for the same fact", () => {
    applyTheme(ADMIN, "dark");
    applyTheme(CUSTOMER, "light");

    // The second write did not overwrite the first, which is the defect the
    // parameter closes: before it, one of these apps decided the other's.
    expect(readStoredTheme(ADMIN)).toBe("dark");
    expect(readStoredTheme(CUSTOMER)).toBe("light");
  });

  it("reads nothing across the two prefixes", () => {
    applyTheme(CUSTOMER, "dark");

    expect(readStoredTheme(ADMIN)).toBeNull();
    // `DEFAULT_THEME`, so a panel with nothing of its own defers to the
    // media query rather than inheriting another app's choice.
    expect(preferredTheme(ADMIN)).toBe("system");
  });

  it("paints from whichever prefix was applied, since the class is one document's", () => {
    // The class is not per app — a document has one `<html>` — so this is the
    // half the prefix deliberately does not partition.
    applyTheme(CUSTOMER, "dark");

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
