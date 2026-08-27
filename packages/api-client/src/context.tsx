import type { PrincipalResource } from "@repo/contracts";
import {
  createContext,
  useCallback,
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

/**
 * Replaces the principal the session holds — and **only** the principal.
 *
 * The session store has exactly one writer for the things that make a session:
 * `client.ts` sets the tokens and the principal at login, at refresh and at the
 * bootstrap, and a feature that hydrated them itself would be a second writer
 * of the same state (see `login` in `client.ts`). This is not that. It writes
 * the *display identity* of an account that has just changed its own name
 * through `PATCH /admin/profile`, and it exists because the alternative was
 * worse in both directions: the account menu reads `principal`, so without it
 * an operator renames themselves and watches the old name sit in the corner
 * until the next token refresh — and the fix of having the shell fetch
 * `/admin/profile` on every screen would put a request in a layout to keep a
 * label current.
 *
 * ADR-0033 §The session store already says which of the two this is: the
 * principal lives in the store because it is session identity, and "richer or
 * fresher account data is a `/profile` query like any other". This is that
 * query's answer, handed back to the one place identity is kept.
 *
 * Narrow on purpose, in three ways (the third two from the D3.9 review):
 *
 * - It hands out no store, so nothing gains a way to read a token or to clear
 *   a session that did not already have one.
 * - It takes a principal, and **the population is pinned by the app's door,
 *   not here** (`D9.1`, ADR-0051). `PrincipalResource` is a union covering
 *   both populations; a client pinned to one segment can only ever receive
 *   that one's principal, so accepting the union in a package that does not
 *   know its segment is correct, and narrowing it is the consuming app's job.
 *   `apps/admin`'s `shared/api` door re-exports this pinned to
 *   `StaffPrincipalResource`, which is safe by contravariance — a function
 *   accepting the union satisfies one that accepts a member — so every call
 *   site in that app keeps the guarantee it had before the move.
 * - **It refuses to write into a store with no session.** `setSession` merges,
 *   so this could never forge authentication — `isAuthenticated` derives from
 *   the access token. What it could do is repopulate a store that logout had
 *   just cleared: the sidebar's sign-out is outside the form's `fieldset`, so
 *   ending the session while a name save is in flight is reachable, and the
 *   `onSuccess` that follows would write the operator's name and address back
 *   into memory an explicit logout had emptied.
 */
export const useSetPrincipal = (): ((principal: PrincipalResource) => void) => {
  const { store } = useApi();

  return useCallback(
    (principal: PrincipalResource) => {
      if (store.getAccessToken() === null) return;

      store.setSession({ principal });
    },
    [store],
  );
};
