import type { ReactNode } from "react";

import { useT } from "@/shared/i18n";
import { UiStringsProvider } from "@/shared/ui";

/**
 * The app's half of the design system's `UiStrings` seam (ADR-0046 §12).
 *
 * `packages/ui` knows which of its strings are injectable and nothing else —
 * no i18next, no namespace, no locale. This is the join, and `app` is where a
 * join belongs (ADR-0032): `shared/i18n` knows how to translate a key and
 * nothing about the design system, `shared/ui` re-exports a provider and knows
 * nothing about keys, and one file puts the two together.
 *
 * **It re-renders on `languageChanged` because `useTranslation` does.** There is
 * no subscription here and there should not be: react-i18next already
 * re-renders every component that called `useT` when the language settles, and
 * this component's whole output is a call to `t` per key. The primitives below
 * read
 * them from context on their own next render, which is the same paint.
 *
 * The object is rebuilt on every render and deliberately not memoised —
 * `UiStringsProvider` memoises on the strings themselves, precisely so no
 * caller has to.
 *
 * It must sit **inside** `I18nProvider`, which `SettingsProvider` renders. That
 * is the same ordering the boot screen loses to: `AppLoader` is the fallback of
 * both gates and renders above the instance, so a dialog there — there is none
 * — would read the English defaults. Which is what the defaults are for.
 */

export interface AppUiStringsProps {
  readonly children: ReactNode;
}

export const AppUiStrings = ({ children }: AppUiStringsProps) => {
  const { t } = useT("common");

  return (
    <UiStringsProvider
      strings={{
        close: t("ui.close"),
        previous: t("ui.previous"),
        next: t("ui.next"),
        morePages: t("ui.morePages"),
        more: t("ui.more"),
        toggleSidebar: t("ui.toggleSidebar"),
        /*
         * The seven `D7.6` added. Three still have no rendering site in this
         * app — `apps/admin`'s pager is `shared/grid/grid-pager.tsx`, not the
         * `pagination` primitive — while `breadcrumb` gained one at `D8.6`,
         * when the shell's trail became the first screen to compose the
         * primitives the door has exported since D3.3. Supplied anyway, for
         * the reason the four before them were: the key then has a `t()` call
         * site the drift check can see, and D12's customer app may well mount
         * the primitive this one declined to.
         */
        sidebarTitle: t("ui.sidebarTitle"),
        sidebarDescription: t("ui.sidebarDescription"),
        previousPage: t("ui.previousPage"),
        nextPage: t("ui.nextPage"),
        pagination: t("ui.pagination"),
        breadcrumb: t("ui.breadcrumb"),
        notifications: t("ui.notifications"),
        /*
         * The first key a *composition* asked for rather than a generated
         * primitive (`D8.2`): `Banner`'s dismiss control. It arrives through
         * the same seam for the same reason — the design system still names no
         * i18n dependency, and the key still has a `t()` call site the drift
         * check can see.
         */
        dismiss: t("ui.dismiss"),
        /*
         * The second composition key (`D10.1`, ADR-0052 §Felt navigation): the
         * navigation indicator's accessible name. An indeterminate
         * `progressbar` announces no value, so this string is the whole of
         * what a screen reader is told while a route resolves.
         */
        navigating: t("ui.navigating"),
      }}
    >
      {children}
    </UiStringsProvider>
  );
};
