import {
  ApiProvider,
  createApiClient,
  createBootstrap,
  createSessionStore,
  type ApiClient,
  type ApiSegment,
  type BootstrapOutcome,
  type SessionStore,
} from "@repo/api-client";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { I18nContext } from "react-i18next";

/**
 * The session, wired once for a running app — moved here at `D22.1`
 * (ADR-0077 §1, a delta on ADR-0062 §1 and its `D14.8` amendment).
 *
 * `D14.8` kept this file in the apps because a session store is bound to a
 * segment. Read side by side, the two copies differed in exactly that — the
 * segment — and in one sentence, and each difference is a value. (A third
 * difference was not one: the customer's notice carried `bg-background` and
 * the admin's did not, over a `body` that paints the same token. The kit
 * ships the class.) So the kit
 * owns the machinery and an app states the two values plus the API's address:
 * `app/providers/session.tsx` is one call of {@link createAppSession}.
 *
 * **The kit still learns no route name, no resource name and no policy.** A
 * segment is none of the three: it is the parameter `@repo/api-client` has
 * taken since `D9.1`, passed through.
 *
 * The React-facing hooks are **not** here. They are `@repo/api-client`'s, and
 * each app reaches them through `shared/api/context`, because a feature may
 * not import from `app` (ADR-0049).
 */

/**
 * The key both apps' `common` catalogues carry for the notice below.
 *
 * Read from a package, so no scan of an app's `src/` can see it: both apps
 * name it in their drift check's `DYNAMIC` list, beside `loading.starting`.
 */
const UNREACHABLE_KEY = "boot.unreachable";

export interface UnreachableNoticeCopy {
  /**
   * The app's eagerly bundled English sentence for `common:boot.unreachable`
   * — what is shown when no i18next instance is mounted yet, which is the
   * state this screen is normally in.
   */
  readonly fallback: string;
  /**
   * What the sentence interpolates. The admin names the variable that holds
   * the API's address, because its reader runs the panel; the customer app
   * passes nothing, because its reader is a customer.
   *
   * Identifiers rather than copy, which is why they are interpolated instead
   * of being written inside the sentence — a translator must not be handed a
   * string they could helpfully translate.
   */
  readonly values?: Readonly<Record<string, string>>;
}

export interface AppSessionOptions {
  /** The app's population, and the only place it is stated (ADR-0051). */
  readonly segment: ApiSegment;
  /** The API's origin, from the app's own `shared/config`. */
  readonly baseUrl: string;
  /** The sentence shown when the API cannot be reached at all. */
  readonly unreachable: UnreachableNoticeCopy;
}

export interface SessionProviderProps {
  readonly children: ReactNode;
  /** Overridden in tests; the app always uses the session's own singletons. */
  readonly client?: ApiClient;
  readonly store?: SessionStore;
  /** Overridden in tests to skip the two network calls. */
  readonly bootstrap?: () => Promise<BootstrapOutcome>;
  /** What renders while the boot sequence is in flight. */
  readonly fallback?: ReactNode;
}

export interface AppSession {
  readonly sessionStore: SessionStore;
  readonly apiClient: ApiClient;
  readonly bootstrapSession: () => Promise<BootstrapOutcome>;
  /**
   * Late-bound so the client can announce a dead session without importing
   * the router, which imports the app's session module, which builds the
   * client. One assignment in the app's router closes the loop where it is
   * visible, rather than three modules importing each other in a ring.
   */
  readonly onSessionEnded: (handler: () => void) => void;
  readonly SessionProvider: (props: SessionProviderProps) => ReactNode;
}

const interpolate = (
  sentence: string,
  values: Readonly<Record<string, string>>,
): string =>
  Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, value),
    sentence,
  );

/**
 * The screen someone gets when the API cannot be reached at all.
 *
 * **The one screen besides `AppLoader` that renders before i18next exists**
 * (ADR-0046 §3). Both are `SessionProvider` states and the i18n provider is
 * mounted inside this gate, so `useTranslation` here would not degrade to
 * English — it would warn and hand back the key. It reads `I18nContext` and
 * falls back to the app's eagerly bundled `en`, which is the only catalogue
 * that could be in memory this early in any case.
 *
 * The values are **interpolated rather than marked up**: a sentence with an
 * element inside it has exactly one answer in react-i18next — `<Trans>` —
 * which needs the provider this screen renders above.
 */
const UnreachableNotice = ({
  fallback,
  values = {},
}: UnreachableNoticeCopy) => {
  const context = useContext(I18nContext);
  const message =
    context?.i18n.t(UNREACHABLE_KEY, { ...values }) ??
    interpolate(fallback, values);

  return (
    <div
      className="flex min-h-svh items-center justify-center bg-background p-6 text-center text-sm text-muted-foreground"
      role="alert"
    >
      {message}
    </div>
  );
};

/**
 * One session for one document: the store, the client pinned to the app's
 * segment, the boot sequence and the provider that gates on it.
 *
 * A factory, called once at module scope in the app. The store and the client
 * are singletons there because there is exactly one session per document, and
 * because the router — created at module scope beside it — needs the same
 * store its guards read. Tests never touch an app's singletons: they build
 * their own store and client and pass them through the provider's props.
 */
export const createAppSession = ({
  segment,
  baseUrl,
  unreachable,
}: AppSessionOptions): AppSession => {
  let sessionEndedHandler: () => void = () => undefined;

  const onSessionEnded = (handler: () => void): void => {
    sessionEndedHandler = handler;
  };

  const sessionStore = createSessionStore();

  const apiClient = createApiClient({
    store: sessionStore,
    baseUrl,
    segment,
    onSessionEnded: () => {
      sessionEndedHandler();
    },
  });

  const bootstrapSession = createBootstrap(apiClient);

  /**
   * Holds the app behind a loading gate until the boot sequence resolves
   * (ADR-0033 §Boot, ADR-0030 for the CSRF half).
   *
   * The gate is the point. A protected route that rendered before the refresh
   * landed would see an empty store, and the app's guard would bounce a
   * legitimately signed-in person to `/login` on every reload. Nothing below
   * renders until the store is either hydrated or known to be empty.
   *
   * A bootstrap that *throws* is not "anonymous" — `bootstrapSession` already
   * turns a failed refresh into that. It means `GET /auth/csrf` itself could
   * not be reached, so the API is down or misconfigured, and it is shown
   * rather than swallowed: sending someone to a login screen that cannot work
   * either is the least useful thing this could do.
   */
  const SessionProvider = ({
    children,
    client = apiClient,
    store = sessionStore,
    bootstrap = bootstrapSession,
    fallback = null,
  }: SessionProviderProps): ReactNode => {
    const [state, setState] = useState<"booting" | "ready" | "unreachable">(
      "booting",
    );

    /*
     * `StrictMode` double-invokes effects in development, which would
     * otherwise run the boot sequence twice: two `GET /auth/csrf` and two
     * refreshes, deduped only if they happen to overlap. The bootstrap is safe
     * to repeat — ADR-0030's endpoint echoes rather than rotates, and
     * `refreshSession` is single-flight — but a second refresh is a second
     * rotation, so the promise is created once and kept.
     *
     * The latch guards the **promise**, never the subscription, and that
     * distinction is the whole comment. Returning early from the effect
     * instead leaves the first run's `cancelled` flag — already set by
     * StrictMode's cleanup — as the only one the pending promise ever checks,
     * so `setState` never fires and the gate holds a blank screen forever.
     * Every run attaches its own handlers; only the request is shared.
     */
    const booting = useRef<Promise<BootstrapOutcome> | null>(null);

    useEffect(() => {
      let cancelled = false;

      booting.current ??= bootstrap();

      booting.current
        .then(() => {
          if (!cancelled) setState("ready");
        })
        .catch(() => {
          if (!cancelled) setState("unreachable");
        });

      return () => {
        cancelled = true;
      };
    }, [bootstrap]);

    if (state === "booting") return <>{fallback}</>;

    if (state === "unreachable") {
      return <UnreachableNotice {...unreachable} />;
    }

    return <ApiProvider value={{ client, store }}>{children}</ApiProvider>;
  };

  return {
    sessionStore,
    apiClient,
    bootstrapSession,
    onSessionEnded,
    SessionProvider,
  };
};
