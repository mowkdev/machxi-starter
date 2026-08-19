import { useEffect, useRef, useState, type ReactNode } from "react";

import { createBootstrap, type BootstrapOutcome } from "@/shared/api/bootstrap";
import { createApiClient, type ApiClient } from "@/shared/api/client";
import { ApiProvider } from "@/shared/api/context";
import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";
import { config } from "@/shared/config";

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
   * `StrictMode` double-invokes effects in development, which would run the
   * boot sequence twice: two `GET /auth/csrf` and two refreshes, deduped only
   * if they happen to overlap. The bootstrap is safe to repeat — ADR-0030's
   * endpoint echoes rather than rotates since D3.2, and `refreshSession` is
   * single-flight — so this is noise rather than a hazard, but a second
   * refresh is a second rotation and there is no reason to spend one.
   */
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let cancelled = false;

    bootstrap()
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
    return (
      <div
        className="flex min-h-svh items-center justify-center p-6 text-center text-sm text-muted-foreground"
        role="alert"
      >
        The API is not reachable. Check that it is running and that
        <code className="mx-1">VITE_API_URL</code> points at it.
      </div>
    );
  }

  return <ApiProvider value={{ client, store }}>{children}</ApiProvider>;
};
