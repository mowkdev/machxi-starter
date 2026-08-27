import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";

import { AppUiStrings } from "@/app/providers/ui-strings";
import { EN_RESOURCES, NAMESPACES, createI18n, type I18n } from "@/shared/i18n";
import enCommon from "@/shared/i18n/locales/en/common.json";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  SidebarProvider,
  SidebarTrigger,
} from "@/shared/ui";

/**
 * The design system's injectable strings, fed from `common` (`D7.3`, ADR-0046 §12).
 *
 * `packages/ui`'s own suite proves the seam works and that its English defaults
 * answer with no provider mounted. What only this side can prove is the two
 * halves being *joined*: that the strings on screen come from
 * `en/common.json` rather than from the design system's identical defaults, and
 * that they follow a locale switch — which is the whole reason the seam exists,
 * and the one claim a matching default would hide.
 *
 * So the switch is driven with a `lv` catalogue supplied at construction rather
 * than with the shipped one, which is still `{}` until `D7.6`. That is also
 * what gives the first assertion teeth: `Close` is on screen because the
 * catalogue says so, and `Aizvērt` replaces it because the catalogue says so,
 * and no default is capable of producing the second.
 *
 * Each surface is rendered on its own. A modal `Dialog` marks the rest of the
 * document `aria-hidden`, so a tree holding the sidebar behind an open dialog
 * would hide the trigger from every role query.
 */

/** Not Latvian, and not claiming to be: `D7.6` writes the real catalogue. */
const LV_UI = {
  close: "Aizvērt",
  toggleSidebar: "Pārslēgt sānjoslu",
} as const;

const withLatvian = (): I18n =>
  createI18n({
    resources: {
      en: EN_RESOURCES,
      /*
       * Every namespace, empty but for the two strings under test: `Catalogue`
       * is `Record<Namespace, object>`, and `D7.4` took the namespace count
       * from four to ten. The empty ones are what a partly-translated locale
       * looks like, which is the state this test is about.
       */
      lv: {
        common: { ui: LV_UI },
        errors: {},
        auth: {},
        dashboard: {},
        profile: {},
        staff: {},
        users: {},
        settings: {},
      },
    },
    namespaces: NAMESPACES,
    locale: "en",
  });

const dialog: ReactElement = (
  <Dialog open>
    <DialogContent>
      <DialogTitle>A record</DialogTitle>
      <DialogDescription>Its detail.</DialogDescription>
    </DialogContent>
  </Dialog>
);

const sidebar: ReactElement = (
  <SidebarProvider>
    <SidebarTrigger />
  </SidebarProvider>
);

const renderUnder = (i18n: I18n, ui: ReactElement) =>
  render(
    <I18nextProvider i18n={i18n.instance}>
      <AppUiStrings>{ui}</AppUiStrings>
    </I18nextProvider>,
  );

afterEach(() => {
  window.localStorage.clear();
});

describe("AppUiStrings", () => {
  it("names the dialog's close button from the en catalogue", () => {
    renderUnder(withLatvian(), dialog);

    /*
     * Asserted against the JSON rather than against a literal, which is what
     * makes this a test of the *wiring*: change the key's value in
     * `en/common.json` and this follows, while a hardcoded "Close" would pass
     * whether the bridge existed or not.
     */
    expect(
      screen.getByRole("button", { name: enCommon.ui.close }),
    ).toBeInTheDocument();
  });

  it("names the sidebar trigger from the same catalogue", () => {
    renderUnder(withLatvian(), sidebar);

    expect(
      screen.getByRole("button", { name: enCommon.ui.toggleSidebar }),
    ).toBeInTheDocument();
  });

  it("renames the trigger when the language changes, without a remount", async () => {
    const i18n = withLatvian();

    renderUnder(i18n, sidebar);

    const trigger = screen.getByRole("button", {
      name: enCommon.ui.toggleSidebar,
    });

    await i18n.changeLocale("lv");

    // The same DOM node, renamed — `useTranslation` re-renders the bridge and
    // the primitive reads the new value from context on that same paint.
    await waitFor(() => {
      expect(trigger).toHaveAccessibleName(LV_UI.toggleSidebar);
    });
  });

  it("reaches a primitive rendered into a portal", async () => {
    const i18n = withLatvian();

    renderUnder(i18n, dialog);

    await i18n.changeLocale("lv");

    /*
     * Radix renders dialog content into a portal, and React context reaches
     * through one — which is what lets `app/index.tsx` mount the bridge once
     * above the router instead of once per screen.
     */
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: LV_UI.close }),
      ).toBeInTheDocument();
    });
  });

  it("falls back to the en catalogue for a key the locale has not translated", async () => {
    const i18n = withLatvian();

    await i18n.changeLocale("lv");

    /*
     * `lv` above carries two of the fourteen. The other twelve come back in
     * English through i18next's own fallback and never reach the design
     * system's defaults — which is what keeps a half-finished catalogue a
     * readable app rather than a mixed one, and is the state `D7.6` starts
     * from. The fourteenth is `D8.2`'s `ui.dismiss`, the first key a
     * composition rather than a generated primitive asked for.
     */
    expect(i18n.instance.t("common:ui.close")).toBe(LV_UI.close);
    expect(i18n.instance.t("common:ui.morePages")).toBe(enCommon.ui.morePages);
  });
});
