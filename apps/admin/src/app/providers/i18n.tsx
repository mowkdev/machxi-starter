import type { Locale } from "@repo/contracts";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { I18nextProvider } from "react-i18next";

import { config } from "@/shared/config";
import {
  EN_RESOURCES,
  LocalePublisherProvider,
  NAMESPACES,
  createI18n,
  preferredLocale,
  type LocalePublisher,
} from "@/shared/i18n";

/**
 * The i18next instance, created once and mounted (ADR-0046 §4, §13).
 *
 * `app` is wiring (ADR-0032) and this is one more join: `shared/i18n` knows how
 * to build an instance and nothing about where a locale comes from, and
 * `entities/settings` knows the account's locale and nothing about i18next.
 *
 * **It sits inside `SettingsProvider`, which is what makes the first step of
 * the precedence real.** ADR-0046 §4 puts the account's locale ahead of the
 * device's, and the account's locale is only known once the settings query has
 * settled — which is precisely the gate `D6.3` already installed. Mounted
 * above that gate this provider could read only `localStorage` and
 * `navigator`, and the account fact would arrive as a re-render rather than as
 * the answer.
 *
 * The shape is the theme's, deliberately (`shared/theme`): a device value
 * decides the first render, the account's value is adopted once per distinct
 * value, and a latch keeps adoption from fighting an operator who changes it
 * afterwards. The difference is that the theme has a pre-paint apply in
 * `main.tsx` and this does not — there is no copy to flash before React, and
 * `<html lang>` is set by `createI18n` on the render this provider first runs.
 */

export interface I18nProviderProps {
  readonly children: ReactNode;
  /**
   * The account's locale, once `GET /settings` has answered. `undefined` while
   * the app is anonymous or the read failed, which leaves the device cache and
   * `navigator.languages` as the only sources — the app an operator has before
   * they sign in, every morning.
   */
  readonly adopted?: Locale | undefined;
  /**
   * Where a chosen locale also goes when there is an account to hold it
   * (`D7.5`). `undefined` signed out: the device cache is then the only owner,
   * which is the app an operator has before they sign in.
   */
  readonly publish?: LocalePublisher | undefined;
}

export const I18nProvider = ({
  children,
  adopted,
  publish,
}: I18nProviderProps) => {
  /*
   * A lazy `useState` rather than a module-level constant: the instance is per
   * mounted app, which is what lets the suite render two of them at two
   * locales in one file. Re-creating it on a render would discard every loaded
   * catalogue, so the initialiser runs once and the value never changes.
   */
  const [i18n] = useState(() =>
    createI18n({
      // Stated at the composition root since `D9.2`: `@repo/i18n` defaults it to
      // the first namespace, and this app says which it means (ADR-0046 §3).
      resources: { en: EN_RESOURCES },
      namespaces: NAMESPACES,
      locale: preferredLocale(adopted ?? null),
      /*
       * The one place the pseudo-locale is switched on in the running app
       * (`D7.6`, ADR-0046 §10). `app` is wiring and configuration is what
       * `shared/config` reads, so the flag travels the same road every other
       * dependency does; `shared/i18n` takes it as a parameter and never asks
       * the environment anything.
       */
      pseudo: config.VITE_I18N_PSEUDO,
    }),
  );

  /*
   * Seeded with what the instance was built from, so a mount whose account
   * locale was already known does not immediately ask i18next to change to the
   * language it is already in.
   */
  const lastAdopted = useRef<Locale | null>(adopted ?? null);

  useEffect(() => {
    if (adopted === undefined || adopted === lastAdopted.current) return;

    lastAdopted.current = adopted;
    void i18n.changeLocale(adopted);
  }, [adopted, i18n]);

  /*
   * The latch is moved by an operator's own choice as well as by the account's
   * answer, and that is what stops the round trip coming back as a second
   * language change. `useUpdateSettings` writes the response into the settings
   * cache, so `adopted` arrives a moment later holding exactly what the
   * operator just picked; without this line the effect above would see a value
   * differing from the *previous* adoption and ask i18next to change to the
   * language it is already in.
   */
  const publishChoice = useCallback(
    (next: Locale) => {
      lastAdopted.current = next;
      publish?.(next);
    },
    [publish],
  );

  return (
    <I18nextProvider i18n={i18n.instance}>
      <LocalePublisherProvider publish={publishChoice}>
        {children}
      </LocalePublisherProvider>
    </I18nextProvider>
  );
};
