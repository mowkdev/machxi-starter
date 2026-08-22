import { useEffect, useMemo, type ReactNode } from "react";

import {
  createServerPreferenceAdapter,
  createSettingsWriter,
  useSettings,
  useUpdateSettings,
} from "@/entities/settings";
import { useSession } from "@/shared/api/context";
import { createLocalStorageAdapter } from "@/shared/grid/preferences";
import { PreferenceStorageProvider } from "@/shared/grid/use-grid-preferences";
import { ThemeProvider } from "@/shared/theme";

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

export const SettingsProvider = ({
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
      <PreferenceStorageProvider value={storage}>
        {children}
      </PreferenceStorageProvider>
    </ThemeProvider>
  );
};
