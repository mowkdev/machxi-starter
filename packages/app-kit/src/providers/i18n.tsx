import type { Locale } from "@repo/contracts";
import type { I18n, LocalePublisher } from "@repo/i18n";
import { LocalePublisherProvider } from "@repo/i18n";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { I18nextProvider } from "react-i18next";

/**
 * The i18n provider (ADR-0046 §4), extracted at `D14.8` (ADR-0062 §1).
 *
 * The two apps' copies were code-identical to the character. What made them
 * app code was one expression — building the instance from *this* app's
 * catalogues, namespaces, device cache and pseudo flag — so that expression is
 * the factory's one parameter and everything around it lives here once.
 *
 * The shape is the theme's, deliberately: a device value decides the first
 * render, the account's value is adopted once per distinct value, and a latch
 * keeps adoption from fighting somebody who changes it afterwards. The
 * difference is that the theme has a pre-paint apply in `main.tsx` and this
 * does not — there is no copy to flash before React, and `<html lang>` is set
 * by `createI18n` on the render this provider first runs.
 */
export interface I18nProviderProps {
  readonly children: ReactNode;
  /**
   * The account's locale, once the settings query has answered. `undefined`
   * while the app is anonymous or the read failed, which leaves the device
   * cache and `navigator.languages` as the only sources.
   */
  readonly adopted?: Locale | undefined;
  /**
   * Where a chosen locale also goes when there is an account to hold it.
   * `undefined` signed out: the device cache is then the only owner.
   */
  readonly publish?: LocalePublisher | undefined;
}

/**
 * Binds an app's instance builder and returns its provider.
 *
 * A factory rather than a `build` prop, because the instance must be created
 * exactly once per mounted app: a prop would re-identify on every render of
 * whatever composed it, and a lazy `useState` closing over a changing prop is
 * the kind of correctness that holds only while nobody edits the caller.
 */
export const createI18nProvider = (
  build: (adopted: Locale | null) => I18n,
): ((props: I18nProviderProps) => ReactNode) => {
  const I18nProvider = ({ children, adopted, publish }: I18nProviderProps) => {
    /*
     * A lazy `useState` rather than a module-level constant: the instance is
     * per mounted app, which is what lets a suite render two of them at two
     * locales in one file. Re-creating it on a render would discard every
     * loaded catalogue, so the initialiser runs once and the value never
     * changes.
     */
    const [i18n] = useState(() => build(adopted ?? null));

    const lastAdopted = useRef<Locale | null>(adopted ?? null);

    useEffect(() => {
      if (adopted === undefined || adopted === lastAdopted.current) return;

      lastAdopted.current = adopted;
      void i18n.changeLocale(adopted);
    }, [adopted, i18n]);

    /*
     * The latch is moved by a person's own choice as well as by the account's,
     * because publishing writes the account row this provider then reads back:
     * without this line the effect above would see a value differing from the
     * *previous* adoption and ask i18next to change to the language it is
     * already in.
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

  return I18nProvider;
};
