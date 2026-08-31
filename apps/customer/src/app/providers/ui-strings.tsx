import type { ReactNode } from "react";

import { useT } from "@/shared/i18n";
import { UiStringsProvider } from "@/shared/ui";

/**
 * The app's half of the design system's `UiStrings` seam (ADR-0046 §12), on its
 * second app (`D12.5`, ADR-0055 §2).
 *
 * `packages/ui` knows which of its strings are injectable and nothing else — no
 * i18next, no namespace, no locale. This is the join, and `app` is where a join
 * belongs (ADR-0049): `shared/i18n` knows how to translate a key and nothing
 * about the design system, `shared/ui` re-exports a provider and knows nothing
 * about keys, and one file puts the two together.
 *
 * **It arrives with the shell rather than at `D12.1`, because until now nothing
 * in this app said any of these words.** The sign-in screen is a card, a form
 * and a button; the shell is the first thing here to mount `SidebarTrigger`,
 * `SidebarRail` and the mobile `Sheet`, each of which announces itself to a
 * screen reader in English out of `DEFAULT_UI_STRINGS`. The route walk under
 * the pseudo-locale is what says so out loud — an unaccented "Toggle Sidebar"
 * is exactly the finding ADR-0046 §10 built that suite to make.
 *
 * **Partial on purpose, which is the seam's own design.** The provider takes
 * `Partial<UiStrings>` and every key it is not given keeps its English default,
 * so this app supplies the five its screens can actually render today and no
 * more. A key handed over without a rendering site would be a catalogue entry
 * the drift check cannot see used — this app's `i18n:check` reports orphans —
 * and a claim that a primitive is mounted when it is not. The rest arrive with
 * the primitives that say them: `dismiss` with `D12.7`'s pseudo-locale banner,
 * `notifications` with `D12.6`'s toaster, and the pagination and breadcrumb
 * keys with the grid this app does not have (ADR-0055 §3).
 *
 * **It re-renders on `languageChanged` because `useTranslation` does.** There is
 * no subscription here and there should not be: react-i18next already
 * re-renders every component that called `useT` when the language settles, and
 * this component's whole output is a call to `t` per key. The object is rebuilt
 * on every render and deliberately not memoised — `UiStringsProvider` memoises
 * on the strings themselves, precisely so no caller has to.
 *
 * It must sit **inside** `I18nProvider`, which is where `app/index.tsx` puts it.
 * The boot gate's two pre-i18next screens render above the instance and get the
 * English defaults, which is what the defaults are for.
 */

export interface AppUiStringsProps {
  readonly children: ReactNode;
}

export const AppUiStrings = ({ children }: AppUiStringsProps) => {
  const { t } = useT("common");

  return (
    <UiStringsProvider
      strings={{
        /* `sheet.tsx`'s corner button, below the `md` breakpoint. */
        close: t("ui.close"),
        /* `sidebar.tsx` — the trigger's `sr-only` label and the rail's. */
        toggleSidebar: t("ui.toggleSidebar"),
        /* `sidebar.tsx` — the mobile sheet's `sr-only` title and description. */
        sidebarTitle: t("ui.sidebarTitle"),
        sidebarDescription: t("ui.sidebarDescription"),
        /*
         * `compositions/app-shell.tsx` — the navigation indicator's accessible
         * name (ADR-0052 §Felt navigation). An indeterminate `progressbar`
         * announces no value, so this string is the whole of what a screen
         * reader is told while a route resolves.
         */
        navigating: t("ui.navigating"),
      }}
    >
      {children}
    </UiStringsProvider>
  );
};
