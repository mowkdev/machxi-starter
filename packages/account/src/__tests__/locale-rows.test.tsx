import { LOCALES, type Locale } from "@repo/contracts";
import { localeStorageKey } from "@repo/i18n";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLocaleRows } from "../preferences/locale-rows";

import {
  DEVICE_KEY_PREFIX,
  OptionsControl,
  renderAccount,
} from "./support/render";
import { server } from "./support/server";

/**
 * Choosing the language the app speaks, certified where the control lives
 * (`D22.2`, ADR-0077 §4; ADR-0046 §4, ADR-0053 §2).
 *
 * **The admin door's suite, moved with the code and with no claim weakened**,
 * for the reason its appearance twin gives: the cases were written against
 * roles and accessible names, so a control that moved from an app to a package
 * is the same control to every one of them. The two values an app binds are
 * the harness's here — the stand-in options control and the `test.account`
 * device prefix.
 *
 * Two halves are asserted and they are asserted apart, because the control
 * cannot tell them apart either. The **device** half is `useLocale` alone and
 * works with no publisher anywhere near it. The **account** half is a
 * publisher the settings gate installs, and what this control owes it is one
 * call with the enum member — asked here with a spy in the publisher's seat.
 * That the call becomes a `PATCH /settings` is the app's wiring of the gate,
 * and the admin door's suite keeps that case.
 */
const LocaleRows = createLocaleRows(OptionsControl);

const LOCALE_KEY = localeStorageKey(DEVICE_KEY_PREFIX);

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("lang");
});

afterEach(() => {
  window.localStorage.clear();
});

describe("the language control", () => {
  it("offers exactly the locales the contract declares, each named in itself", () => {
    renderAccount(<LocaleRows />);

    const options = screen.getAllByRole("radio");

    expect(options).toHaveLength(LOCALES.length);
    /*
     * Endonyms: a person opens this section *because* the current language is
     * wrong for them, so `Latviešu` has to be legible from inside English —
     * and they reach it through two pieces of chrome they may not be able to
     * read either, which is what makes the self-naming load bearing rather
     * than a nicety.
     */
    expect(
      options.map((option) => option.closest("label")?.textContent),
    ).toEqual(["English", "Latviešu"]);
    expect(options.map((option) => option.getAttribute("value"))).toEqual([
      ...LOCALES,
    ]);
    expect(screen.getByRole("radio", { name: "English" })).toBeChecked();
    expect(screen.getByRole("group", { name: "Language" })).toBeInTheDocument();
  });

  it("moves the document's language and remembers the choice on the device", async () => {
    const user = userEvent.setup();

    renderAccount(<LocaleRows />);
    await user.click(screen.getByRole("radio", { name: "Latviešu" }));

    await waitFor(() => {
      /*
       * The Intl tag and not the enum member (ADR-0046 §4): `en` *means*
       * en-GB here, and `<html lang>` is what a screen reader picks a voice
       * from.
       */
      expect(document.documentElement.lang).toBe("lv-LV");
    });
    expect(window.localStorage.getItem(LOCALE_KEY)).toBe("lv");
  });

  it("marks the current choice, so the section says what is in force", async () => {
    const user = userEvent.setup();

    renderAccount(<LocaleRows />);
    await user.click(screen.getByRole("radio", { name: "Latviešu" }));

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Latviešu" })).toBeChecked();
    });
    expect(screen.getByRole("radio", { name: "English" })).not.toBeChecked();
  });

  /**
   * With no publisher there is no account and the control still works — which
   * is what `LocalePublisher` being `undefined` rather than absent is for.
   *
   * The admin suite asked this as "nobody signed in" and counted the `PATCH`es
   * its settings handlers had seen. Here there are no handlers to count with,
   * so the claim is made of the wire itself: the control sent nothing at all.
   */
  it("still switches with no publisher installed, and writes only the device", async () => {
    const user = userEvent.setup();
    const requests: string[] = [];
    const onRequest = ({ request }: { readonly request: Request }) => {
      requests.push(`${request.method} ${request.url}`);
    };

    server.events.on("request:start", onRequest);

    try {
      renderAccount(<LocaleRows />);

      await user.click(screen.getByRole("radio", { name: "Latviešu" }));

      await waitFor(() => {
        expect(window.localStorage.getItem(LOCALE_KEY)).toBe("lv");
      });
      expect(screen.getByRole("radio", { name: "Latviešu" })).toBeChecked();
      expect(requests).toEqual([]);
    } finally {
      server.events.removeListener("request:start", onRequest);
    }
  });

  it("speaks the language it was switched to", async () => {
    const user = userEvent.setup();

    renderAccount(<LocaleRows />);
    await user.click(screen.getByRole("radio", { name: "Latviešu" }));

    // The group's own name moves, which is the running instance changing and
    // not only the stored preference.
    expect(
      await screen.findByRole("group", { name: "Valoda" }),
    ).toBeInTheDocument();
  });

  it("hands the choice to the publisher when one is installed, and still writes the device", async () => {
    const user = userEvent.setup();
    const publishLocale = vi.fn<(locale: Locale) => void>();

    renderAccount(<LocaleRows />, { publishLocale });

    await user.click(screen.getByRole("radio", { name: "Latviešu" }));

    /*
     * Once, and with the enum member rather than the Intl tag: the account
     * row holds `lv`, and `lv-LV` is what the document is told.
     */
    expect(publishLocale).toHaveBeenCalledTimes(1);
    expect(publishLocale).toHaveBeenCalledWith("lv");
    await waitFor(() => {
      expect(window.localStorage.getItem(LOCALE_KEY)).toBe("lv");
    });
  });
});
