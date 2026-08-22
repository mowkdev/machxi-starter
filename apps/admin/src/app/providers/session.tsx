import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { I18nContext } from "react-i18next";

import { createBootstrap, type BootstrapOutcome } from "@/shared/api/bootstrap";
import { createApiClient, type ApiClient } from "@/shared/api/client";
import { ApiProvider } from "@/shared/api/context";
import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";
import { config } from "@/shared/config";
import { EN_RESOURCES } from "@/shared/i18n";

/**
 * The variable the notice below names, spelled once.
 *
 * It is the *name* of a configuration key rather than a value read from one, so
 * it is not an ADR-0004 read and does not belong in `shared/config`; and it is
 * an identifier rather than copy, which is why it is interpolated into the
 * sentence instead of being written inside it — a translator must not be handed
 * a string they could helpfully translate.
 */
const API_URL_VARIABLE = "VITE_API_URL";

/**
 * The session, wired once for the running app (ADR-0032: `app` is wiring).
 *
 * The store and the client are module-scope singletons because there is exactly
 * one session per document, and because the router — created at module scope in
 * `./router` — needs the same store its guards read. Tests never touch these:
 * they build their own with `createSessionStore` / `createApiClient` and pass
 * them through `ApiProvider`, which is the whole reason those are factories.
 *
 * The React-facing hooks are **not** here. They live in `shared/api/context`,
 * because a feature may not import from `app` (ADR-0032) — a `useApiClient`
 * exported from this file would be unusable by the login form that needs it.
 */

/**
 * Late-bound so the client can announce a dead session without importing the
 * router, which imports this module, which builds the client. One assignment in
 * `./router` closes the loop where it is visible, rather than three modules
 * importing each other in a ring.
 */
let sessionEndedHandler: () => void = () => undefined;

export const onSessionEnded = (handler: () => void): void => {
  sessionEndedHandler = handler;
};

export const sessionStore: SessionStore = createSessionStore();

export const apiClient: ApiClient = createApiClient({
  store: sessionStore,
  baseUrl: config.VITE_API_URL,
  onSessionEnded: () => {
    sessionEndedHandler();
  },
});

export const bootstrapSession = createBootstrap(apiClient);

export interface SessionProviderProps {
  readonly children: ReactNode;
  /** Overridden in tests; the app always uses the module-scope singletons. */
  readonly client?: ApiClient;
  readonly store?: SessionStore;
  /** Overridden in tests to skip the two network calls. */
  readonly bootstrap?: () => Promise<BootstrapOutcome>;
  /** What renders while the boot sequence is in flight. */
  readonly fallback?: ReactNode;
}

/**
 * The screen an operator gets when the API cannot be reached at all.
 *
 * **The second screen that renders before i18next exists** (`D7.6`, ADR-0046
 * §3). `AppLoader` is the first and this is its twin: both are `SessionProvider`
 * states, and `I18nProvider` is mounted two gates further in, so
 * `useTranslation` here would not degrade to English — it would warn and hand
 * back `boot.unreachable`. It reads `I18nContext` and falls back to the eagerly
 * bundled `en`, which is the only catalogue that could be in memory this early
 * in any case.
 *
 * The variable name is **interpolated rather than marked up**. It was an inline
 * `<code>` until `D7.6`, and a sentence with an element inside it has exactly
 * one answer in react-i18next — `<Trans>` — which needs the provider this
 * screen renders above. One key an operator can read beats two fragments a
 * translator has to reassemble around markup, so the sentence stayed whole and
 * the monospace went.
 */
const UnreachableNotice = () => {
  const context = useContext(I18nContext);
  const message =
    context?.i18n.t("boot.unreachable", { variable: API_URL_VARIABLE }) ??
    EN_RESOURCES.common.boot.unreachable.replace(
      "{{variable}}",
      API_URL_VARIABLE,
    );

  return (
    <div
      className="flex min-h-svh items-center justify-center p-6 text-center text-sm text-muted-foreground"
      role="alert"
    >
      {message}
    </div>
  );
};

/**
 * Holds the app behind a loading gate until the boot sequence resolves
 * (ADR-0033 §Boot).
 *
 * The gate is the point. A protected route that rendered before the refresh
 * landed would see an empty store, and the `_dashboard` guard would bounce a
 * legitimately signed-in operator to `/login` on every reload. Nothing below
 * renders until the store is either hydrated or known to be empty.
 *
 * A bootstrap that *throws* is not "anonymous" — `bootstrapSession` already
 * turns a failed refresh into that. It means `GET /auth/csrf` itself could not
 * be reached, so the API is down or misconfigured, and it is shown rather than
 * swallowed: sending an operator to a login screen that cannot work either is
 * the least useful thing this could do.
 */
export const SessionProvider = ({
  children,
  client = apiClient,
  store = sessionStore,
  bootstrap = bootstrapSession,
  fallback = null,
}: SessionProviderProps) => {
  const [state, setState] = useState<"booting" | "ready" | "unreachable">(
    "booting",
  );

  /*
   * `StrictMode` double-invokes effects in development, which would otherwise
   * run the boot sequence twice: two `GET /auth/csrf` and two refreshes, deduped
   * only if they happen to overlap. The bootstrap is safe to repeat — ADR-0030's
   * endpoint echoes rather than rotates since D3.2, and `refreshSession` is
   * single-flight — but a second refresh is a second rotation, so the promise is
   * created once and kept.
   *
   * The latch guards the **promise**, never the subscription, and that
   * distinction is the whole comment. Returning early from the effect instead
   * leaves the first run's `cancelled` flag — already set by StrictMode's
   * cleanup — as the only one the pending promise ever checks, so `setState`
   * never fires and the gate holds a blank screen forever. Every run attaches
   * its own handlers; only the request is shared.
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
    return <UnreachableNotice />;
  }

  return <ApiProvider value={{ client, store }}>{children}</ApiProvider>;
};
