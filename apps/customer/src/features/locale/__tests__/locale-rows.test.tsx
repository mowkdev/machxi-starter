import { LOCALES } from "@repo/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocaleRows } from "@/features/locale";
import { LOCALE_STORAGE_KEY } from "@/shared/i18n";
import { renderWithProviders } from "@/test/render";

/**
 * The language door's binding (`D22.2`, ADR-0077 §4; ADR-0046 §4, ADR-0053
 * §2).
 *
 * **One smoke case, because the control is `@repo/account`'s and is certified
 * there**, in the package's `locale-rows.test.tsx`. What the package cannot
 * ask is the one thing this slice does: hand the control `@repo/app-kit`'s
 * real `SettingsOptions`, over this app's instance and its device prefix.
 *
 * The account half is asked where it is wired, by the page suite in
 * `pages/account/__tests__/preferences.test.tsx`.
 */
beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("lang");
});

afterEach(() => {
  window.localStorage.clear();
});

describe("the language door", () => {
  it("draws the package's control with the kit's control, under this app's device key", async () => {
    const user = userEvent.setup();

    renderWithProviders(<LocaleRows />);

    expect(screen.getByRole("group", { name: "Language" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(LOCALES.length);

    await user.click(screen.getByRole("radio", { name: "Latviešu" }));

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Latviešu" })).toBeChecked();
    });
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("lv");
  });
});
