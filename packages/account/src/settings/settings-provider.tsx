import { useSession } from "@repo/api-client";
import { GridDensityProvider } from "@repo/app-services";
import type { Locale, Theme } from "@repo/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  type ComponentType,
  type ReactNode,
} from "react";

import { useSettings, useUpdateSettings } from "./settings.queries";
import {
  createServerPreferenceAdapter,
  createSettingsWriter,
  type GridPreferenceSeam,
  type PreferenceStorage,
} from "./settings.storage";

/**
 * The account's settings, wired into the running app (ADR-0045 §The client) —
 * one gate for both apps since `D22.2` (ADR-0077 §2).
 *
 * This is where the settings query, the preference contexts and the i18next
 * instance are joined. None of them knows about the others; this does. The two
 * apps' copies differed in one thing, whether a grid preference adapter is
 * mounted, and that is {@link SettingsProviderDeps.grids}.
 *
 * **It is a second boot gate, inside the first.** ADR-0033's session gate
 * holds the app until the session is hydrated or known to be empty; this holds
 * it until the settings query has *settled* for an authenticated principal.
 * Three providers make the first render the one that counts:
 *
 * - A grid reads its storage once at mount (ADR-0041's synchronous `read`), so
 *   one that mounted before the mirror was seeded would render the device's
 *   arrangement and never hear about the account's.
 * - The i18n provider builds the instance once, from the preferred locale, so
 *   an account locale arriving after that is a language **change** rather than
 *   the answer (ADR-0046 §4 puts the account ahead of the device).
 * - `GridDensityProvider` seeds its state from `adopted` on the render it
 *   mounts, and only adopts later answers in an effect.
 *
 * One request buys all three. The theme is the one that would survive without
 * it, because `main.tsx` has already painted the device's value before React
 * existed and the provider adopts in an effect.
 *
 * **A failed read is not a gate failure.** It settles to "device only", which
 * is the app a person has before they sign in, and no toast — there is no
 * action a message here would prompt.
 *
 * **What the package does not name arrives as a slot** (ADR-0077 §2). The
 * theme provider carries the app's device-key prefix, the i18n provider is
 * built from the app's dictionary, and the principal-cache boundary is
 * `@repo/app-kit`'s, which this package may not depend on.
 */

/** An adopted value and where a change to it also goes. */
interface PreferenceSlotProps<TValue> {
  readonly children: ReactNode;
  /** The account's value, once `GET /settings` has answered. */
  readonly adopted?: TValue | undefined;
  /** Where a change also goes when there is an account to remember it. */
  readonly publish?: ((value: TValue) => void) | undefined;
}

export interface SettingsProviderDeps {
  /** `@repo/app-services`' provider with the app's device-key prefix bound. */
  readonly ThemeProvider: ComponentType<PreferenceSlotProps<Theme>>;
  /** The app's i18n provider, built over its own catalogues. */
  readonly I18nProvider: ComponentType<PreferenceSlotProps<Locale>>;
  /** The kit's boundary, bound to the app's key function (`D13.6`). */
  readonly PrincipalCacheBoundary: ComponentType<{
    readonly children: ReactNode;
  }>;
  /** Who the cache belongs to, as one comparable string. */
  readonly usePrincipalCacheOwner: () => string;
  /**
   * The grid preference adapter's seam and the provider that mounts it.
   *
   * The admin passes both; the customer passes none, because ADR-0055 §3 keeps
   * `@repo/grid` out of that app until a domain entity arrives.
   *
   * `cache` must be referentially stable — a module-level constant in the door
   * that binds it. The preference store is memoised on the adapter it is
   * given and the writer holds this for the life of the session, so one built
   * per render would rebuild every grid's store every render, which is an
   * infinite loop rather than a slow path.
   */
  readonly grids?:
    | (GridPreferenceSeam & {
        readonly Provider: ComponentType<{
          readonly value: PreferenceStorage;
          readonly children: ReactNode;
        }>;
      })
    | undefined;
}

export interface SettingsProviderProps {
  readonly children: ReactNode;
  /** What renders while an authenticated principal's settings are in flight. */
  readonly fallback?: ReactNode;
}

export const createSettingsProvider = ({
  ThemeProvider,
  I18nProvider,
  PrincipalCacheBoundary,
  usePrincipalCacheOwner,
  grids,
}: SettingsProviderDeps): ((props: SettingsProviderProps) => ReactNode) => {
  /**
   * The provider proper, mounted **once per principal** (`D13.6`).
   *
   * Everything below this line is per-session state that the settings query
   * alone does not describe: the coalescing writer's mirror of the account's
   * grids with its `seeded` and `decided` latches, its pending half, and the
   * adoption latches in the three providers at the bottom — the i18next
   * instance among them, which is *built* from a locale rather than told one.
   * Dropping the cache entry without resetting those would evict the answer
   * and keep the conclusions drawn from it.
   *
   * The key is the reset (`SettingsProvider` below), which is React's own
   * answer to "this subtree belongs to a different thing now" and costs
   * nothing on the path that matters: an authenticated principal whose
   * settings are in flight unmounts this subtree anyway, for the gate's own
   * reasons.
   */
  const AccountSettings = ({
    children,
    fallback = null,
  }: SettingsProviderProps) => {
    const { isAuthenticated } = useSession();
    const settings = useSettings({ enabled: isAuthenticated });
    const { mutateAsync: patchSettings } = useUpdateSettings();

    const writer = useMemo(() => createSettingsWriter({ grids }), []);

    /*
     * The sender is installed rather than captured. `mutateAsync` belongs to a
     * component and is a render-time value; a writer built with one would hold
     * whichever it was handed first. Subscribing from an effect is the same
     * shape every other store here uses, and it means the writer knows nothing
     * about React or about requests.
     *
     * The rejection is swallowed *here* because the global mutation handler
     * has already turned it into the one toast a person sees (ADR-0043); an
     * unhandled rejection out of a debounce timer would be noise nobody can
     * act on.
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
     * Seeded **during render**, not in an effect, and the ordering is the
     * whole reason. The gate opens on the render where the query first has
     * data; its children — grids among them — mount in that same commit and
     * call `read` synchronously. An effect runs after that, which is one
     * render too late: every grid would already have read an empty mirror.
     *
     * A `useMemo` is the render-phase hook that runs exactly when its input
     * changes, which is what "once per distinct response" needs. It carries a
     * side effect, which a memo normally should not — and can only do so
     * because `sync` is idempotent: React is free to discard and recompute
     * this, and a second call with the same resource lands on the same mirror.
     *
     * Only where there is a grid to read the mirror: without the seam nothing
     * ever asks it anything.
     */
    useMemo(() => {
      if (grids !== undefined && settings.data !== undefined) {
        writer.sync(settings.data);
      }
    }, [settings.data, writer]);

    /*
     * The locale's account half (`D7.5`, ADR-0046 §4, §6).
     *
     * Straight through `useUpdateSettings` rather than through the coalescing
     * writer, and the difference from the theme is the interaction rather than
     * the value: a column drag produces a write per frame and a language is
     * chosen once, deliberately. There is nothing to coalesce, and a second's
     * debounce on the one write a person would notice failing is a second of
     * not knowing.
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

    const serverStorage = useMemo(
      () =>
        grids === undefined
          ? undefined
          : createServerPreferenceAdapter({ writer, grids }),
      [writer],
    );

    /*
     * The **session** decides whether there is an account, not the cache.
     * `enabled: false` only stops a query from fetching; the entry it already
     * has stays, and `staleTime: Infinity` means it is never refetched. So
     * after a sign-out in this tab `settings.data` is still the principal who
     * just left, and reading it directly would keep the server adapter and the
     * account publishers mounted on the sign-in screen. Signed out, the app is
     * the device alone (ADR-0045 §The server adapter).
     */
    const account = isAuthenticated ? settings.data : undefined;

    /*
     * `enabled: false` leaves a query pending with an idle fetch forever, so
     * "settled" has to be read as "there is nothing in flight for us to wait
     * on" rather than as `isSuccess || isError`. An anonymous visitor pays
     * nothing and renders immediately.
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
         * (`D7.1`, ADR-0046 §4). It is mounted *here*, below the gate, because
         * the first step of its precedence is the account's settings row and
         * this is the component that holds it — anonymous, `adopted` is
         * `undefined` and the device's cache answers instead.
         */}
        <I18nProvider
          adopted={account?.locale}
          publish={account === undefined ? undefined : publishLocale}
        >
          {/*
           * The theme's third sibling (`D11.6`, ADR-0053 §2). It adopts the
           * same way and publishes through the same coalescing writer, so a
           * density change beside a theme change or a column drag is one
           * `PATCH`; signed out there is nothing to publish to and the mode is
           * the contract's default.
           */}
          <GridDensityProvider
            adopted={account?.gridDensity}
            publish={account === undefined ? undefined : writer.setGridDensity}
          >
            {grids === undefined || serverStorage === undefined ? (
              children
            ) : (
              <grids.Provider
                value={account === undefined ? grids.cache : serverStorage}
              >
                {children}
              </grids.Provider>
            )}
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
   * previous account's entry from a query cached with `staleTime: Infinity`
   * and change nothing at all. The key drops what the app *concluded* from
   * that resource — the writer's seeded mirror, the three adoption latches —
   * without which the eviction would refetch into conclusions already drawn.
   * It is also the key that makes the eviction *observable*:
   * `queryCache.clear()` destroys queries without notifying their observers,
   * so a mounted `useSettings` would go on rendering the old `data` until
   * something else re-rendered it; the remount destroys every observer
   * instead.
   *
   * The composition is not the root's to get right. Nothing sits under the
   * boundary but outside this provider, so a wrapper that mounted one without
   * the other would be a silent return to the `D11.11` defect with every test
   * still green.
   */
  const SettingsProvider = ({ children, fallback }: SettingsProviderProps) => {
    const owner = usePrincipalCacheOwner();

    return (
      <PrincipalCacheBoundary>
        <AccountSettings fallback={fallback} key={owner}>
          {children}
        </AccountSettings>
      </PrincipalCacheBoundary>
    );
  };

  return SettingsProvider;
};
