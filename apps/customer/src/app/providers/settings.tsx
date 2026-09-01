import type { Locale } from "@repo/contracts";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";

import {
  createSettingsWriter,
  useSettings,
  useUpdateSettings,
} from "@/entities/settings";
import { useSession } from "@/shared/api/context";
import { GridDensityProvider } from "@/shared/density";
import { ThemeProvider } from "@/shared/theme";

import { I18nProvider } from "./i18n";
import {
  PrincipalCacheBoundary,
  usePrincipalCacheOwner,
} from "./principal-cache";

/**
 * The account's settings, wired into the running app (`D12.7`; ADR-0045 §The
 * client as carried by ADR-0053, ADR-0055 §3).
 *
 * `app` is wiring (ADR-0049), and this is the file where three things that live
 * in three different layers are joined: the settings query in
 * `entities/settings`, the preference contexts in `shared/theme` and
 * `shared/density`, and the i18next instance. None of them knows about the
 * others; this does.
 *
 * **It is a second boot gate, inside the first**, and this app's reasons for it
 * are not the admin's. There the gate exists because ADR-0041's `read` is
 * synchronous and a grid that mounted before the mirror was seeded would render
 * the device's arrangement; this app has no grid at all (ADR-0055 §3). What it
 * has are two providers whose *first* render is the one that counts:
 *
 * - `I18nProvider` builds the i18next instance once, from `preferredLocale`, so
 *   an account locale arriving after that is a language **change** rather than
 *   the answer — a customer whose account says Latvian would read a frame of
 *   English first (ADR-0046 §4 puts the account ahead of the device).
 * - `GridDensityProvider` seeds its state from `adopted` on the render it
 *   mounts, and only adopts later answers in an effect.
 *
 * One request buys both. The theme is the one that would survive without it,
 * because `main.tsx` has already painted the device's value before React
 * existed and the provider adopts in an effect.
 *
 * **A failed read is not a gate failure.** It settles to "device only", which
 * is exactly the app a customer has before they sign in — the theme and locale
 * caches, and no toast, because there is no action a message here would prompt.
 */

export interface SettingsProviderProps {
  readonly children: ReactNode;
  /** What renders while an authenticated customer's settings are in flight. */
  readonly fallback?: ReactNode;
}

/**
 * The provider proper, mounted **once per principal** (`D13.6`).
 *
 * Everything below this line is per-session state that the settings query alone
 * does not describe: the coalescing writer's pending half, and the adoption
 * latches in the three providers at the bottom — the i18next instance among
 * them, which is *built* from a locale rather than told one. Dropping the cache
 * entry without resetting those would evict the answer and keep the conclusions
 * drawn from it.
 *
 * The key is the reset (`SettingsProvider` below), which is React's own answer
 * to "this subtree belongs to a different thing now" and costs nothing on the
 * path that matters: an authenticated customer whose settings are in flight
 * unmounts this subtree anyway, for the gate's own reasons.
 */
const AccountSettings = ({
  children,
  fallback = null,
}: SettingsProviderProps) => {
  const { isAuthenticated } = useSession();
  const settings = useSettings({ enabled: isAuthenticated });
  const { mutateAsync: patchSettings } = useUpdateSettings();

  const writer = useMemo(() => createSettingsWriter(), []);

  /*
   * The sender is installed rather than captured. `mutateAsync` belongs to a
   * component and is a render-time value; a writer built with one would hold
   * whichever it was handed first. Subscribing from an effect is the same shape
   * every other store in this app uses, and it means the writer knows nothing
   * about React or about requests.
   *
   * The rejection is swallowed *here* because the global mutation handler has
   * already turned it into the one toast the customer sees (ADR-0034); an
   * unhandled rejection out of a debounce timer would be noise nobody can act
   * on.
   */
  useEffect(
    () =>
      writer.subscribe((body) => {
        void patchSettings(body).catch(() => undefined);
      }),
    [writer, patchSettings],
  );

  useEffect(
    () => () => {
      writer.dispose();
    },
    [writer],
  );

  /*
   * The locale's account half (ADR-0046 §4).
   *
   * Straight through `useUpdateSettings` rather than through the coalescing
   * writer, and the difference from the theme is the interaction rather than
   * the value: the theme rides a writer built for a column drag, and a language
   * is chosen once, deliberately, by somebody who has just walked to a settings
   * page to do it. There is nothing to coalesce, and a second's debounce on the
   * one write a customer would notice failing is a second of not knowing.
   *
   * The rejection is swallowed here for the reason the writer's is. The
   * language itself has already changed — the account row is what did not.
   */
  const publishLocale = useCallback(
    (locale: Locale) => {
      void patchSettings({ locale }).catch(() => undefined);
    },
    [patchSettings],
  );

  /*
   * The **session** decides whether there is an account, not the cache.
   * `enabled: false` only stops a query from fetching; the entry it already has
   * stays, and `staleTime: Infinity` means it is never refetched. So after a
   * sign-out in this tab `settings.data` is still the customer who just left,
   * and reading it directly would keep the account publishers mounted on the
   * sign-in screen.
   */
  const account = isAuthenticated ? settings.data : undefined;

  /*
   * `enabled: false` leaves a query pending with an idle fetch forever, so
   * "settled" has to be read as "there is nothing in flight for us to wait on"
   * rather than as `isSuccess || isError`. An anonymous visitor pays nothing
   * and renders immediately.
   */
  if (
    isAuthenticated &&
    settings.isPending &&
    settings.fetchStatus !== "idle"
  ) {
    return <>{fallback}</>;
  }

  return (
    <ThemeProvider
      adopted={account?.theme}
      publish={account === undefined ? undefined : writer.setTheme}
    >
      {/*
       * The locale is the theme's sibling and is adopted the same way
       * (ADR-0046 §4). It is mounted *here*, below the gate, because the first
       * step of its precedence is the account's settings row and this is the
       * component that holds it — anonymous, `adopted` is `undefined` and the
       * device's cache answers instead.
       */}
      <I18nProvider
        adopted={account?.locale}
        publish={account === undefined ? undefined : publishLocale}
      >
        {/*
         * The theme's third sibling (ADR-0053 §2). It adopts the same way and
         * publishes through the same coalescing writer, so a density change and
         * a theme change in one second are one `PATCH`; signed out there is
         * nothing to publish to and the mode is the contract's default, which
         * is what an anonymous app has always shown.
         */}
        <GridDensityProvider
          adopted={account?.gridDensity}
          publish={account === undefined ? undefined : writer.setGridDensity}
        >
          {children}
        </GridDensityProvider>
      </I18nProvider>
    </ThemeProvider>
  );
};

/**
 * The account's settings, scoped to the principal they belong to (`D13.6`).
 *
 * **The eviction has two halves, both load-bearing, and they are mounted
 * together here so that neither can ship without the other.** The boundary
 * drops the cached resource, without which the remount would re-read the
 * previous customer's entry from a query cached with `staleTime: Infinity` and
 * change nothing at all. The key drops what this app *concluded* from that
 * resource — the three adoption latches, the i18next instance among them — without
 * which the eviction would refetch into conclusions already drawn. It is also
 * the key that makes the eviction *observable*: `queryCache.clear()` destroys
 * queries without notifying their observers, so a mounted `useSettings` would
 * go on rendering the old `data` until something else re-rendered it; the
 * remount destroys every observer instead.
 *
 * The composition is not `app/index.tsx`'s to get right. Nothing in `App` sits
 * under the boundary but outside this provider, so a wrapper that mounted one
 * without the other would be a silent return to the `D11.11` defect with every
 * test still green.
 */
export const SettingsProvider = ({
  children,
  fallback,
}: SettingsProviderProps) => {
  const owner = usePrincipalCacheOwner();

  return (
    <PrincipalCacheBoundary>
      <AccountSettings fallback={fallback} key={owner}>
        {children}
      </AccountSettings>
    </PrincipalCacheBoundary>
  );
};
