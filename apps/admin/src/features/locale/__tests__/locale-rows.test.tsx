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
 * Choosing the language the panel speaks (`D7.5`, moved to the page at
 * `D11.10`; ADR-0046 §4, ADR-0053 §2).
 *
 * **The menu suite with the surface swapped and nothing weakened**, for the
 * reason its appearance twin gives: these cases were written against roles and
 * accessible names, so a control that moved from a dropdown to a card is the
 * same control to every one of them.
 *
 * Two halves are asserted and they are asserted apart, because the slice cannot
 * tell them apart either: the **device** half is `useLocale` alone and works
 * with no session anywhere near it, and the **account** half arrives through
 * the publisher `app/providers` installs — which is what makes "the language
 * follows the operator to the next machine" a property of the wiring rather
 * than of this control. The signed-out case is the one that changed meaning
 * rather than shape, and the note on it is where it is made.
 */

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("lang");
});

afterEach(() => {
  window.localStorage.clear();
});

describe("the language control", () => {
  it("offers exactly the locales the contract declares, each named in itself", () => {
    renderWithProviders(<LocaleRows />);

    const options = screen.getAllByRole("radio");

    expect(options).toHaveLength(LOCALES.length);
    /*
     * Endonyms: an operator opens this section *because* the current language
     * is wrong for them, so `Latviešu` has to be legible from inside English —
     * and since `D11.10` they reach it through two pieces of chrome they may
     * not be able to read either, which is what makes the self-naming load
     * bearing rather than a nicety.
     */
    expect(
      options.map((option) => option.closest("label")?.textContent),
    ).toEqual(["English", "Latviešu"]);
    expect(screen.getByRole("radio", { name: "English" })).toBeChecked();
    expect(screen.getByRole("group", { name: "Language" })).toBeInTheDocument();
  });

  it("moves the document's language and remembers the choice on the device", async () => {
    const user = userEvent.setup();

    renderWithProviders(<LocaleRows />);
    await user.click(screen.getByRole("radio", { name: "Latviešu" }));

    await waitFor(() => {
      /*
       * The Intl tag and not the enum member (ADR-0046 §4, amended `D7.1`):
       * `en` *means* en-GB here, and `<html lang>` is what a screen reader
       * picks a voice from.
       */
      expect(document.documentElement.lang).toBe("lv-LV");
    });
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("lv");
  });

  it("marks the current choice, so the section says what is in force", async () => {
    const user = userEvent.setup();

    renderWithProviders(<LocaleRows />);
    await user.click(screen.getByRole("radio", { name: "Latviešu" }));

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Latviešu" })).toBeChecked();
    });
    expect(screen.getByRole("radio", { name: "English" })).not.toBeChecked();
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

  /**
   * Signed out there is no account and the control still works — which is what
   * `LocalePublisher` being `undefined` rather than absent is for.
   *
   * **What this case proves changed at `D11.10` and it is kept deliberately.**
   * While the switch hung in the account menu, the signed-out screen it
   * mattered on was the login, and the case stood for "the one place an
   * operator most needs the switch has nothing to write to". `/account` is
   * behind `_dashboard` now, so no *route* renders this control without a
   * session — and the property is still the component's: it holds no opinion
   * about whether there is an account, which is precisely why moving it
   * between surfaces has never needed a change below its own file.
   */
  it("still switches with nobody signed in, and writes only the device", async () => {
    const user = userEvent.setup();
    const state = createSettingsMockState();

    server.use(...createSettingsHandlers(state));

    renderWithProviders(<LocaleRows />);

    await user.click(screen.getByRole("radio", { name: "Latviešu" }));

    await waitFor(() => {
      expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("lv");
    });
    expect(state.seen.patches).toEqual([]);
  });
});
