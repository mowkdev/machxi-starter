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
 * The session, wired once for the running app (ADR-0049: `app` is wiring).
 *
 * The store and the client are module-scope singletons because there is exactly
 * one session per document, and because the router — created at module scope in
 * `./router` — needs the same store its guards read. Tests never touch these:
 * they build their own with `createSessionStore` / `createApiClient` and pass
 * them through `ApiProvider`, which is the whole reason those are factories.
 *
 * The React-facing hooks are **not** here. They live in `shared/api/context`,
 * because a feature may not import from `app` (ADR-0049) — a `useApiClient`
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
  /*
   * **The app's population, and the only place it is stated** (ADR-0055 §2).
   *
   * `@repo/api-client` is segment-agnostic since `D9.1`, and this one word is
   * the whole of what makes this app the customer app on the wire: every
   * request goes to `/api/v1/user`, and `shared/api/context` narrows the
   * principal to match. ADR-0015's segments are enforced server-side either
   * way — this is the client agreeing rather than the client deciding.
   */
  segment: "user",
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
 * The screen someone gets when the API cannot be reached at all.
 *
 * **The one screen besides `AppLoader` that renders before i18next exists**
 * (ADR-0046 §3). Both are `SessionProvider` states and `I18nProvider` is
 * mounted inside this gate, so `useTranslation` here would not degrade to
 * English — it would warn and hand back `boot.unreachable`. It reads
 * `I18nContext` and falls back to the eagerly bundled `en`, which is the only
 * catalogue that could be in memory this early in any case.
 *
 * **It names no environment variable, and that is the one line that differs
 * from the admin's.** The admin's notice interpolates `VITE_API_URL`, because
 * the person reading it is a developer or an operator running the panel. The
 * person reading this one is a customer, for whom a build-time variable name is
 * noise at best and a hint about our infrastructure at worst — so the sentence
 * says what happened and what they can do, and the diagnosis stays in the
 * console where the client already logs it.
 */
const UnreachableNotice = () => {
  const context = useContext(I18nContext);
  const message =
    context?.i18n.t("boot.unreachable") ?? EN_RESOURCES.common.boot.unreachable;

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
 * Holds the app behind a loading gate until the boot sequence resolves
 * (ADR-0033 §Boot, ADR-0030 for the CSRF half).
 *
 * The gate is the point. A protected route that rendered before the refresh
 * landed would see an empty store, and the `_dashboard` guard would bounce a
 * legitimately signed-in customer to `/login` on every reload. Nothing below
 * renders until the store is either hydrated or known to be empty.
 *
 * A bootstrap that *throws* is not "anonymous" — `bootstrapSession` already
 * turns a failed refresh into that. It means `GET /auth/csrf` itself could not
 * be reached, so the API is down or misconfigured, and it is shown rather than
 * swallowed: sending someone to a login screen that cannot work either is the
 * least useful thing this could do.
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
   * endpoint echoes rather than rotates, and `refreshSession` is single-flight —
   * but a second refresh is a second rotation, so the promise is created once
   * and kept.
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
