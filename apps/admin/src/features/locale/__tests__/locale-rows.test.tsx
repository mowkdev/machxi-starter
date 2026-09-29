import { LOCALES } from "@repo/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SettingsProvider } from "@/app/providers/settings";
import { LocaleRows } from "@/features/locale";
import { LOCALE_STORAGE_KEY } from "@/shared/i18n";
import {
  createSettingsHandlers,
  createSettingsMockState,
} from "@/test/msw/handlers/settings.handlers";
import { server } from "@repo/app-kit/testing";
import { authenticatedAs } from "@/test/principals";
import { renderWithProviders } from "@/test/render";

/**
 * The language door's binding, and the wiring behind it (`D22.2`, ADR-0077
 * §4; ADR-0046 §4, ADR-0053 §2).
 *
 * **The control is `@repo/account`'s and is certified there.** Four of the
 * five cases this file held — the contract's endonyms, the document's
 * language and the device key, the marked choice, the switch with no account
 * — moved with the code to the package's `locale-rows.test.tsx`, none of them
 * weakened. Two things remain that the package cannot ask.
 *
 * The **smoke case** is the one thing this slice does: hand the control
 * `@repo/app-kit`'s real `SettingsOptions`, over this app's instance and its
 * device prefix.
 *
 * The **account case** is the app's wiring of the settings gate. The package
 * proves the control calls a publisher; that the publisher this app installs
 * becomes the `PATCH /settings` the API validates is a property of
 * `app/providers`, and it is asked through the real `SettingsProvider` over
 * MSW because a mock kinder than the server would certify the opposite of
 * production (ADR-0036).
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

  /**
   * The half that makes it an account fact rather than a device one: the same
   * `PATCH /settings` D6 shipped, carrying the field ADR-0045 reserved by name
   * and `D7.1` gave a second value. A second browser reads it back from `GET`,
   * which `app/__tests__/i18n-provider.test.tsx` already asserts from the other
   * end — between them, "signing in elsewhere finds the same language".
   */
  it("writes the choice to the account, so another machine finds it", async () => {
    const user = userEvent.setup();
    const state = createSettingsMockState();

    server.use(...createSettingsHandlers(state));

    renderWithProviders(
      <SettingsProvider>
        <LocaleRows />
      </SettingsProvider>,
      { store: authenticatedAs() },
    );

    await user.click(await screen.findByRole("radio", { name: "Latviešu" }));

    await waitFor(() => {
      expect(state.seen.patches).toEqual([{ locale: "lv" }]);
    });
    expect(state.settings.locale).toBe("lv");
  });
});
