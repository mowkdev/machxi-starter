import { useState, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

import { config } from "@/shared/config";
import {
  EN_RESOURCES,
  NAMESPACES,
  createI18n,
  preferredLocale,
} from "@/shared/i18n";

/**
 * The i18next instance, created once and mounted (ADR-0046 §4, §13).
 *
 * `app` is wiring (ADR-0049) and this is a join: `shared/i18n` knows how to
 * build an instance and nothing about where a locale comes from.
 *
 * **The account's locale is not one of the sources yet, and its absence is the
 * step boundary.** ADR-0046 §4 puts the account's locale ahead of the device's,
 * and the account's locale is only known once `GET /user/settings` has settled
 * — the gate `D12.7` installs. Until then `preferredLocale(null)` reads the
 * device cache and `navigator.languages`, which is exactly the app a customer
 * has before they sign in, every morning. The `adopted`/`publish` pair the
 * admin's provider carries lands with the query that answers it.
 *
 * A lazy `useState` rather than a module-level constant: the instance is per
 * mounted app, which is what lets the suite render two of them at two locales
 * in one file. Re-creating it on a render would discard every loaded catalogue,
 * so the initialiser runs once and the value never changes.
 */
export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [i18n] = useState(() =>
    createI18n({
      // Stated at the composition root: `@repo/i18n` defaults it to the first
      // namespace, and this app says which it means (ADR-0046 §3).
      resources: { en: EN_RESOURCES },
      namespaces: NAMESPACES,
      locale: preferredLocale(null),
      /*
       * The one place the pseudo-locale is switched on in the running app
       * (ADR-0046 §10). `app` is wiring and configuration is what
       * `shared/config` reads, so the flag travels the same road every other
       * dependency does; `shared/i18n` takes it as a parameter and never asks
       * the environment anything.
       */
      pseudo: config.VITE_I18N_PSEUDO,
    }),
  );

  return <I18nextProvider i18n={i18n.instance}>{children}</I18nextProvider>;
};
