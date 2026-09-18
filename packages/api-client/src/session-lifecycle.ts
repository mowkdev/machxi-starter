import type { AuthResource, CsrfResource } from "@repo/contracts";
import type { AxiosInstance } from "axios";

import { isApiClientError } from "./api-error";
import type { SessionStore } from "./session-store";

/**
 * The session's own lifecycle: how it is refreshed, how it is bootstrapped,
 * and how it ends (ADR-0033, ADR-0030).
 *
 * Split out of `client.ts` at `D20.7`, verbatim. **Not `session.ts`**, which
 * beside `session-store.ts` would read as the same file twice: the store is
 * *where the session is kept* (ADR-0033 §The session store), and this is *what
 * happens to it* — one memory, one lifecycle, and a reader should be able to
 * tell which they have opened from the name alone.
 *
 * **The single-flight refresh lives here and nowhere else.** One factory call
 * means one `inflightRefresh`, and the response interceptor in `transport.ts`
 * is handed `refreshSession` rather than a second copy of the promise — which
 * is the whole property: five requests meeting one expired token must queue
 * behind the same refresh, because refresh rotates (ADR-0018) and the client
 * must not be a machine for triggering its own reuse alarm.
 */

export interface SessionLifecycleDeps {
  readonly instance: AxiosInstance;
  readonly store: SessionStore;
  /**
   * Called when a session ends for good — a terminal code, or a retry that
   * failed again. The app turns this into "clear the store and show /login";
   * the client does not know what a route is.
   */
  readonly onSessionEnded?: (() => void) | undefined;
}

export const createSessionLifecycle = ({
  instance,
  store,
  onSessionEnded,
}: SessionLifecycleDeps) => {
  const endSession = (): void => {
    store.clear();
    onSessionEnded?.();
  };

  /**
   * Ends the session unless the recovery attempt simply never got an answer.
   *
   * `status: 0` is a dropped connection, a captive portal, a DNS failure —
   * no evidence at all about the session, whose refresh cookie is still good
   * and whose server-side row is untouched. Logging the operator out over it
   * costs them their in-flight work to fix nothing, and a forced logout is a
   * real availability bug rather than a safe default.
   */
  const endSessionUnlessOffline = (failure: unknown): void => {
    if (isApiClientError(failure) && failure.status === 0) return;
    endSession();
  };

  /*
   * Single-flight refresh: one shared in-flight promise, and every request that
   * meets a `401` while it is pending queues behind the *same* one.
   *
   * Without it a dashboard that fires five requests on mount turns one expired
   * token into five concurrent refreshes — and refresh rotates (ADR-0018), so
   * four of them replay a just-rotated token. Inside the grace window that is
   * tolerated; outside it, it is reuse detection and the session is revoked.
   * The client must not be a machine for triggering its own reuse alarm.
   */
  let inflightRefresh: Promise<void> | null = null;

  const runRefresh = async (): Promise<void> => {
    const { data } = await instance.post<{ data: AuthResource }>(
      "/auth/refresh",
      {},
    );
    const resource = data.data;

    store.setSession({
      accessToken: resource.accessToken,
      principal: resource.principal,
      ...(resource.csrfToken ? { csrfToken: resource.csrfToken } : {}),
    });
  };

  const refreshSession = (): Promise<void> =>
    (inflightRefresh ??= runRefresh().finally(() => {
      inflightRefresh = null;
    }));

  /** ADR-0030's bootstrap: the one call that cannot itself need a CSRF token. */
  const fetchCsrfToken = async (): Promise<string> => {
    const { data } = await instance.get<{ data: CsrfResource }>("/auth/csrf");

    store.setSession({ csrfToken: data.data.csrfToken });
    return data.data.csrfToken;
  };

  return {
    endSession,
    endSessionUnlessOffline,
    refreshSession,
    fetchCsrfToken,
  } as const;
};
