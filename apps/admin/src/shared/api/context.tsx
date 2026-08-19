import type { PrincipalResource } from "@repo/contracts";
import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { ApiClient } from "./client";
import type { SessionStore } from "./session-store";

/**
 * How the rest of the app reaches the client and the session.
 *
 * This lives in `shared/api` rather than beside the provider that supplies it,
 * and the reason is ADR-0032's dependency rule rather than taste: a feature may
 * not import from `app`, so a `useApiClient` exported from `app/providers`
 * would be unusable by the login form that needs it — and the boundaries lint
 * says so rather than letting it through. `app` keeps what it is for, which is
 * constructing the singletons and deciding when they are ready.
 *
 * Nothing here constructs anything. Both values are passed in, which is what
 * lets a test wrap a component in a client built for that test with no module
 * mocking anywhere (ADR-0036).
 */

export interface ApiContextValue {
  readonly client: ApiClient;
  readonly store: SessionStore;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export const ApiProvider = ({
  children,
  value,
}: {
  children: ReactNode;
  value: ApiContextValue;
}) => <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;

const useApi = (): ApiContextValue => {
  const value = useContext(ApiContext);

  if (value === null) {
    // A component rendered outside the provider would otherwise fail later,
    // somewhere else, as "cannot read property of null".
    throw new Error("useApiClient must be used inside <ApiProvider>");
  }

  return value;
};

export const useApiClient = (): ApiClient => useApi().client;

/**
 * The session as React sees it — **without the credentials**.
 *
 * `useSyncExternalStore` rather than a context value something has to remember
 * to update: the store is the source of truth, React subscribes to it, and a
 * component showing the principal cannot go stale after a refresh rotates it.
 *
 * The tokens are deliberately not returned. The store's whole argument is
 * minimising what a script can walk away with, and handing the access token to
 * every component that wants to know who is signed in would widen that reach
 * for nothing — `client.ts` is the only code that needs them, and it reads the
 * store directly.
 */
export interface SessionView {
  readonly principal: PrincipalResource | null;
  readonly isAuthenticated: boolean;
}

export const useSession = (): SessionView => {
  const { store } = useApi();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  return {
    principal: snapshot.principal,
    isAuthenticated: snapshot.accessToken !== null,
  };
};
