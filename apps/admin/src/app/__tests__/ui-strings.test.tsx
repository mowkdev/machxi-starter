import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";

import { EN_RESOURCES, NAMESPACES, createI18n, type I18n } from "@/shared/i18n";
import enCommon from "@/shared/i18n/locales/en/common.json";
import {
  AppShell,
  AppUiStrings,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  SidebarProvider,
  SidebarTrigger,
  UI_STRING_KEYS,
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
  navigating: "Notiek pāreja",
} as const;

const withLatvian = (): I18n =>
  createI18n({
    resources: {
      en: EN_RESOURCES,
      /*
       * Every namespace, empty but for the two strings under test:
       * `Catalogue` is `Record<AppNamespace, object>`, so the compiler names
       * the one a new slice added rather than leaving it to be noticed. The
       * empty ones are what a partly-translated locale looks like, which is
       * the state this test is about.
       */
      lv: {
        organizations: {},
        common: { ui: LV_UI },
        errors: {},
        auth: {},
        dashboard: {},
        profile: {},
        staff: {},
        users: {},
        settings: {},
        account: {},
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

/*
 * The shell with its navigation indicator up (`D10.1`, ADR-0052 §Felt
 * navigation). A *composition* rather than a generated primitive, and the
 * second of those to ask for a key — so it travels the same seam and is
 * proved the same way.
 */
const shell: ReactElement = (
  <AppShell navigating sidebar={<aside aria-label="Drawer" />} title="Staff">
    <p>Page content</p>
  </AppShell>
);

const renderUnder = (i18n: I18n, ui: ReactElement) =>
  render(
    <I18nextProvider i18n={i18n.instance}>
      <AppUiStrings keys={UI_STRING_KEYS}>{ui}</AppUiStrings>
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

  it("names the shell's navigation indicator from the catalogue, and renames it with the locale", async () => {
    const i18n = withLatvian();

    renderUnder(i18n, shell);

    /*
     * **The assertion has to survive the defaults matching**, which is the
     * whole reason this case lives here rather than beside the wiring test in
     * `navigation-indicator.test.tsx`: `DEFAULT_UI_STRINGS.navigating` and
     * `en/common.json`'s `ui.navigating` are both "Navigating", so an English
     * assertion alone is green whether or not `AppUiStrings` supplies the key
     * at all. The locale switch is what separates them — no design-system
     * default follows a language change, so a bar that renames itself is a bar
     * being fed by this app's catalogue.
     */
    const bar = screen.getByRole("progressbar", {
      name: enCommon.ui.navigating,
    });

    await i18n.changeLocale("lv");

    await waitFor(() => {
      expect(bar).toHaveAccessibleName(LV_UI.navigating);
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
     * `lv` above carries two of the fifteen. The other thirteen come back in
     * English through i18next's own fallback and never reach the design
     * system's defaults — which is what keeps a half-finished catalogue a
     * readable app rather than a mixed one, and is the state `D7.6` starts
     * from. The last two are the compositions': `D8.2`'s `ui.dismiss` and
     * `D10.1`'s `ui.navigating`, the first keys asked for by something other
     * than a generated primitive.
     */
    expect(i18n.instance.t("common:ui.close")).toBe(LV_UI.close);
    expect(i18n.instance.t("common:ui.morePages")).toBe(enCommon.ui.morePages);
  });
});
