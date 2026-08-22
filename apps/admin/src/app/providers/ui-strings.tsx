import type { ReactNode } from "react";

import { useT } from "@/shared/i18n";
import { UiStringsProvider } from "@/shared/ui";

/**
 * The app's half of the design system's `UiStrings` seam (ADR-0046 §12).
 *
 * `packages/ui` knows that six of its strings are injectable and nothing else —
 * no i18next, no namespace, no locale. This is the join, and `app` is where a
 * join belongs (ADR-0032): `shared/i18n` knows how to translate a key and
 * nothing about the design system, `shared/ui` re-exports a provider and knows
 * nothing about keys, and one file puts the two together.
 *
 * **It re-renders on `languageChanged` because `useTranslation` does.** There is
 * no subscription here and there should not be: react-i18next already
 * re-renders every component that called `useT` when the language settles, and
 * this component's whole output is six calls to `t`. The primitives below read
 * them from context on their own next render, which is the same paint.
 *
 * The object is rebuilt on every render and deliberately not memoised —
 * `UiStringsProvider` memoises on the six strings themselves, precisely so no
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
      }}
    >
      {children}
    </UiStringsProvider>
  );
};
