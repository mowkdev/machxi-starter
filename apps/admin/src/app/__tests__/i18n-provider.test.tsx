import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "@/app/providers/i18n";
import { SettingsProvider } from "@/app/providers/settings";
import { createSessionStore } from "@/shared/api/session-store";
import { LOCALE_STORAGE_KEY, useT } from "@/shared/i18n";
import {
  createSettingsHandlers,
  createSettingsMockState,
} from "@/test/msw/handlers/settings.handlers";
import { server } from "@/test/msw/server";
import { authenticatedAs } from "@/test/principals";
import { renderWithProviders } from "@/test/render";

/**
 * The locale, adopted by the app (`D7.1`, ADR-0046 §4).
 *
 * The precedence itself is decided and tested as a pure function in
 * `shared/i18n/__tests__/resolve-locale.test.ts`; what is left for this file is
 * the wiring the function cannot see — that the provider reads the device cache
 * when there is nobody to ask, that the account's locale wins when the settings
 * query answers, and that `<html lang>` follows either of them.
 *
 * `I18nProvider` is rendered bare where the assertion is about the device,
 * because it needs nothing else: a locale before sign-in is exactly the case
 * with no session, no query client and no router in it. The adoption case goes
 * through `SettingsProvider`, because *where* the provider is mounted is the
 * decision being checked — mounted above that gate, the account fact could
 * only ever arrive as a re-render.
 */

/** Reads the running instance the way any localised component will. */
const LanguageProbe = () => {
  const { i18n } = useT();

  return <output data-testid="language">{i18n.language}</output>;
};

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("lang");
});

afterEach(() => {
  window.localStorage.clear();
});

describe("I18nProvider", () => {
  it("opens in en when the device has never said otherwise", () => {
    render(
      <I18nProvider>
        <LanguageProbe />
      </I18nProvider>,
    );

    // Synchronous, with nothing awaited: `en` is the eager catalogue, which is
    // the property the whole harness rests on (ADR-0046 §14).
    expect(screen.getByTestId("language")).toHaveTextContent("en");
    expect(document.documentElement.lang).toBe("en-GB");
  });

  it("opens in the device's language before there is a session to ask", async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "lv");

    render(
      <I18nProvider>
        <LanguageProbe />
      </I18nProvider>,
    );

    /*
     * `<html lang>` is right on the first paint even though the Latvian
     * catalogue is still in flight, because the document's language is a fact
     * about the choice and not about the copy. It is what stops an operator
     * who chose Latvian reading `Sign in` in English every morning.
     */
    expect(document.documentElement.lang).toBe("lv-LV");

    await waitFor(() => {
      expect(screen.getByTestId("language")).toHaveTextContent("lv");
    });
  });

  it("prefers the account's locale over the device's, once it arrives", async () => {
    // The device says English and the account says Latvian: ADR-0045's
    // first-sync rule applied to a scalar — the account is the fact and the
    // device is a cache of it.
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    server.use(
      ...createSettingsHandlers(
        createSettingsMockState({ theme: "system", locale: "lv", grids: {} }),
      ),
    );

    renderWithProviders(
      <SettingsProvider>
        <LanguageProbe />
      </SettingsProvider>,
      { store: authenticatedAs() },
    );

    await waitFor(() => {
      expect(document.documentElement.lang).toBe("lv-LV");
    });
    // Written back through, so the next first paint on this device is right
    // before the settings query has answered again.
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("lv");
  });

  it("adopts nothing when nobody is signed in", async () => {
    const state = createSettingsMockState({
      theme: "system",
      locale: "lv",
      grids: {},
    });

    server.use(...createSettingsHandlers(state));

    renderWithProviders(
      <SettingsProvider>
        <LanguageProbe />
      </SettingsProvider>,
      { store: createSessionStore() },
    );

    /*
     * There is a Latvian row on the server and no session to claim it, so the
     * app is the device's alone — the same rule `D6.3` applied to the theme
     * and to the preference adapter, read here as "the session decides whether
     * there is an account, not the cache".
     */
    expect(screen.getByTestId("language")).toHaveTextContent("en");
    expect(document.documentElement.lang).toBe("en-GB");
    await waitFor(() => {
      expect(state.seen.reads).toBe(0);
    });
  });
});
