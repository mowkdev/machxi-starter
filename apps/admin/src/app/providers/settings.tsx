import type { Locale } from "@repo/contracts";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";

import {
  createServerPreferenceAdapter,
  createSettingsWriter,
  useSettings,
  useUpdateSettings,
} from "@/entities/settings";
import { useSession } from "@/shared/api/context";
import { GridDensityProvider } from "@/shared/density";
import { createLocalStorageAdapter } from "@/shared/grid/preferences";
import { PreferenceStorageProvider } from "@/shared/grid/use-grid-preferences";
import { I18nProvider } from "@/shared/i18n";
import { ThemeProvider } from "@/shared/theme";

import {
  PrincipalCacheBoundary,
  usePrincipalCacheOwner,
} from "./principal-cache";

/**
 * The account's settings, wired into the running app (ADR-0045 §The client).
 *
 * `app` is wiring (ADR-0032), and this is the file where three things that
 * live in three different layers are joined: the settings query in
 * `entities/settings`, ADR-0041's adapter seam in `shared/grid`, and the theme
 * context in `shared/theme`. None of them knows about the others; this does.
 *
 * **It is a second boot gate, inside the first.** ADR-0033's `SessionProvider`
 * holds the app until the session is hydrated or known to be empty; this holds
 * it until the settings query has *settled* for an authenticated principal.
 * The reason is ADR-0041's synchronous `read`: a grid reads its storage once at
 * mount, so a grid that mounted before the mirror was seeded would render the
 * local cache and never hear about the account's arrangement. One request buys
 * the first-sync rule running exactly once, before any store exists.
 *
 * **A failed read is not a gate failure.** It settles to "local only", which is
 * the app the operator had before this deliverable: `localStorage` behind the
 * seam, exactly as ADR-0041 shipped it, and no toast — there is no operator
 * action a message here would prompt.
 */

/**
 * One module-level cache adapter.
 *
 * Referential stability is load-bearing twice over: the preference store is
 * memoised on the adapter it is given, and the writer holds this for the life
 * of the session. Constructing it per render would rebuild every grid's store
 * every render, which is an infinite loop rather than a slow path.
 */
const LOCAL_CACHE = createLocalStorageAdapter();

export interface SettingsProviderProps {
  readonly children: ReactNode;
  /** What renders while an authenticated principal's settings are in flight. */
  readonly fallback?: ReactNode;
}

/**
 * The provider proper, mounted **once per principal** (`D13.6`).
 *
 * Everything below this line is per-session state that the settings query alone
 * does not describe: the coalescing writer's mirror of the account's grids, its
 * `seeded` and `decided` latches, and the adoption latches in the three
 * providers at the bottom. Dropping the cache entry without resetting those
 * would evict the answer and keep the conclusions drawn from it.
 *
 * The key is the reset (`SettingsProvider` below), which is React's own answer
 * to "this subtree belongs to a different thing now" and costs nothing on the
 * path that matters: an authenticated principal whose settings are in flight
 * unmounts this subtree anyway, for the gate's own reasons.
 */
const AccountSettings = ({
  children,
  fallback = null,
}: SettingsProviderProps) => {
  const { isAuthenticated } = useSession();
  const settings = useSettings({ enabled: isAuthenticated });
  const { mutateAsync: patchSettings } = useUpdateSettings();

  const writer = useMemo(
    () => createSettingsWriter({ cache: LOCAL_CACHE }),
    [],
  );

  /*
   * The sender is installed rather than captured. `mutateAsync` belongs to a
   * component and is a render-time value; a writer built with one would hold
   * whichever it was handed first. Subscribing from an effect is the same
   * shape every other store in this app uses, and it means the writer knows
   * nothing about React or about requests.
   *
   * The rejection is swallowed *here* because the global mutation handler has
   * already turned it into the one toast the operator sees (ADR-0043); an
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
   * Seeded **during render**, not in an effect, and the ordering is the whole
   * reason. The gate opens on the render where the query first has data; its
   * children — grids among them — mount in that same commit and call `read`
   * synchronously. An effect runs after that, which is one render too late:
   * every grid would already have read an empty mirror.
   *
   * A `useMemo` is the render-phase hook that runs exactly when its input
   * changes, which is what "once per distinct response" needs. It carries a
   * side effect, which a memo normally should not — and can only do so because
   * `sync` is idempotent: React is free to discard and recompute this, and a
   * second call with the same resource lands on the same mirror.
   */
  useMemo(() => {
    if (settings.data !== undefined) writer.sync(settings.data);
  }, [settings.data, writer]);

  /*
   * The locale's account half (`D7.5`, ADR-0046 §6).
   *
   * Straight through `useUpdateSettings` rather than through the coalescing
   * writer, and the difference from the theme is the interaction rather than
   * the value: a column drag produces a write per frame and a language is
   * chosen once, deliberately, by an operator who has just opened a menu to do
   * it. There is nothing to coalesce, and a second's debounce on the one write
   * an operator would notice failing is a second of not knowing.
   *
   * The rejection is swallowed here for the reason the writer's is: ADR-0043's
   * global mutation handler has already turned it into the one toast the
   * operator sees, and an unhandled rejection would be noise nobody can act on.
   * The language itself has already changed — the account row is what did not.
   */
  const publishLocale = useCallback(
    (locale: Locale) => {
      void patchSettings({ locale }).catch(() => undefined);
    },
    [patchSettings],
  );

  const serverStorage = useMemo(
    () => createServerPreferenceAdapter({ writer, cache: LOCAL_CACHE }),
    [writer],
  );

  /*
   * The **session** decides whether there is an account, not the cache.
   * `enabled: false` only stops a query from fetching; the entry it already
   * has stays, and `staleTime: Infinity` means it is never refetched. So after
   * a logout in this tab `settings.data` is still the principal who just left,
   * and reading it directly would keep the server adapter and the account
   * publisher mounted on the login screen. Signed out, the app is the local
   * adapter alone (ADR-0045 §The server adapter).
   */
  const account = isAuthenticated ? settings.data : undefined;
  const storage = account === undefined ? LOCAL_CACHE : serverStorage;

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
       * The locale is the theme's sibling and is adopted the same way (`D7.1`,
       * ADR-0046 §4). It is mounted *here*, below the gate, because the first
       * step of its precedence is the account's settings row and this is the
       * component that holds it — anonymous, `adopted` is `undefined` and the
       * device's cache answers instead.
       */}
      <I18nProvider
        adopted={account?.locale}
        publish={account === undefined ? undefined : publishLocale}
      >
        {/*
         * The theme's third sibling (`D11.6`, ADR-0053 §2). It adopts the same
         * way and publishes through the same coalescing writer, so a density
         * toggle and a column drag in one second are one `PATCH`; signed out
         * there is nothing to publish to and the grids render comfortable,
         * which is what an anonymous app has always done.
         */}
        <GridDensityProvider
          adopted={account?.gridDensity}
          publish={account === undefined ? undefined : writer.setGridDensity}
        >
          <PreferenceStorageProvider value={storage}>
            {children}
          </PreferenceStorageProvider>
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
 * previous account's entry from a query cached with `staleTime: Infinity` and
 * change nothing at all. The key drops what this app *concluded* from that
 * resource — the writer's seeded mirror, the three adoption latches — without
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
