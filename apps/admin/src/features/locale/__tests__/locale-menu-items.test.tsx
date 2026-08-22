import { LOCALES } from "@repo/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SettingsProvider } from "@/app/providers/settings";
import { LocaleMenuItems } from "@/features/locale";
import { LOCALE_STORAGE_KEY } from "@/shared/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/shared/ui";
import {
  createSettingsHandlers,
  createSettingsMockState,
} from "@/test/msw/handlers/settings.handlers";
import { server } from "@/test/msw/server";
import { authenticatedAs } from "@/test/principals";
import { renderWithProviders } from "@/test/render";

/**
 * Choosing the language the panel speaks (`D7.5`, ADR-0046 §4).
 *
 * Queried by role and accessible name throughout (ADR-0036), for the reason the
 * appearance menu is: "one of two" is a radio group rather than two buttons,
 * and a control a screen reader cannot announce is one a Latvian operator on a
 * screen reader cannot reach.
 *
 * Two halves are asserted and they are asserted apart, because the slice cannot
 * tell them apart either: the **device** half is `useLocale` alone and works
 * with no session anywhere near it, and the **account** half arrives through
 * the publisher `app/providers` installs — which is what makes "the language
 * follows the operator to the next machine" a property of the wiring rather
 * than of this menu.
 */

const menu = (children: React.ReactNode) => (
  <DropdownMenu>
    <DropdownMenuTrigger>Account</DropdownMenuTrigger>
    <DropdownMenuContent>{children}</DropdownMenuContent>
  </DropdownMenu>
);

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("lang");
});

afterEach(() => {
  window.localStorage.clear();
});

describe("the language menu", () => {
  it("offers exactly the locales the contract declares, each named in itself", async () => {
    const user = userEvent.setup();

    renderWithProviders(menu(<LocaleMenuItems />));
    await user.click(screen.getByRole("button", { name: "Account" }));

    const options = await screen.findAllByRole("menuitemradio");

    expect(options).toHaveLength(LOCALES.length);
    /*
     * Endonyms: an operator opens this menu *because* the current language is
     * wrong for them, so `Latviešu` has to be legible from inside English.
     */
    expect(options.map((option) => option.textContent)).toEqual([
      "English",
      "Latviešu",
    ]);
    expect(
      await screen.findByRole("menuitemradio", { name: "English" }),
    ).toBeChecked();
  });

  it("moves the document's language and remembers the choice on the device", async () => {
    const user = userEvent.setup();

    renderWithProviders(menu(<LocaleMenuItems />));
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: "Latviešu" }),
    );

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

  it("marks the current choice, so the menu says what is in force", async () => {
    const user = userEvent.setup();

    renderWithProviders(menu(<LocaleMenuItems />));
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: "Latviešu" }),
    );
    await user.click(screen.getByRole("button", { name: "Account" }));

    await waitFor(async () => {
      expect(
        await screen.findByRole("menuitemradio", { name: "Latviešu" }),
      ).toBeChecked();
    });
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
      <SettingsProvider>{menu(<LocaleMenuItems />)}</SettingsProvider>,
      { store: authenticatedAs() },
    );

    await user.click(await screen.findByRole("button", { name: "Account" }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: "Latviešu" }),
    );

    await waitFor(() => {
      expect(state.seen.patches).toEqual([{ locale: "lv" }]);
    });
    expect(state.settings.locale).toBe("lv");
  });

  /**
   * Signed out there is no account and the control still works — which is what
   * `LocalePublisher` being `undefined` rather than absent is for. The login
   * screen is the one place an operator most needs the switch and the one
   * place there is nothing to write to.
   */
  it("still switches with nobody signed in, and writes only the device", async () => {
    const user = userEvent.setup();
    const state = createSettingsMockState();

    server.use(...createSettingsHandlers(state));

    renderWithProviders(menu(<LocaleMenuItems />));

    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: "Latviešu" }),
    );

    await waitFor(() => {
      expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("lv");
    });
    expect(state.seen.patches).toEqual([]);
  });
});
