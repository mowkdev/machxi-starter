import { DEFAULT_LOCALE, type Locale } from "@repo/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { asLocale } from "./resolve-locale";

/**
 * The locale, as a control rather than as a fact (ADR-0046 §4, `D7.5`).
 *
 * It lives in `shared` for the reason `shared/theme` does (ADR-0032): the
 * control that changes the language is a feature, the shell that hosts it is a
 * widget, and neither may import from `app`. `app/providers/i18n.tsx` is what
 * renders the publisher and what connects it to an account — exactly the
 * relationship `ThemeProvider` has with `app/providers/settings.tsx`.
 *
 * **The device half needs no provider and the account half does**, which is the
 * one way this differs from the theme's shape. `useLocale()` reads the language
 * off the i18next instance the tree is already mounted on and writes it with
 * `changeLanguage`, so a component test that mounts `I18nextProvider` and
 * nothing else gets a working switch — and gets it without the harness having
 * to learn one more provider. What it does *not* get is somewhere to remember
 * the choice, and that is honest: signed out, there is no account to remember
 * it in, and the device cache written by `createI18n`'s own listener is the
 * whole of the memory (ADR-0046 §4, step 2).
 */

/**
 * Where a chosen locale also goes when there is an account to hold it.
 *
 * `null` means "no account": the login screen, an anonymous first visit, a
 * settings read that failed. The switch still works there and still persists to
 * the device; it simply has nowhere else to write.
 */
export type LocalePublisher = (locale: Locale) => void;

const LocalePublisherContext = createContext<LocalePublisher | null>(null);

export interface LocalePublisherProviderProps {
  readonly children: ReactNode;
  readonly publish?: LocalePublisher | undefined;
}

export const LocalePublisherProvider = ({
  children,
  publish,
}: LocalePublisherProviderProps) => (
  <LocalePublisherContext.Provider value={publish ?? null}>
    {children}
  </LocalePublisherContext.Provider>
);

export interface LocaleView {
  /** What the app is rendering in now, as the enum member and not the tag. */
  readonly locale: Locale;
  readonly setLocale: (next: Locale) => void;
}

export const useLocale = (): LocaleView => {
  const { i18n } = useTranslation();
  const publish = useContext(LocalePublisherContext);

  /*
   * `i18n.language` can be a regional tag if something ever hands one to
   * `changeLanguage`; `asLocale` reads it by primary subtag, which is the same
   * rule `resolveInitialLocale` applies to `navigator.languages`. A tag this
   * app does not have falls back to the source language rather than being
   * guessed at.
   */
  const locale = asLocale(i18n.language) ?? DEFAULT_LOCALE;

  const setLocale = useCallback(
    (next: Locale) => {
      /*
       * The device first and the account second — the reverse of their order
       * of importance, and deliberately so. `changeLanguage` is what moves the
       * copy, `<html lang>`, the formatters, the zod maps and the device cache,
       * all through `createI18n`'s own listener; it is synchronous as far as
       * this operator's screen is concerned. The account write is a request
       * that may fail, and a language switch that waited for a round trip
       * before repainting would feel like a page load.
       */
      void i18n.changeLanguage(next);
      publish?.(next);
    },
    [i18n, publish],
  );

  return useMemo<LocaleView>(
    () => ({ locale, setLocale }),
    [locale, setLocale],
  );
};
