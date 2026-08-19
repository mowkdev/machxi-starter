import type { PrincipalResource } from "@repo/contracts";

/**
 * The session, in memory and nowhere else (ADR-0033 §The session store).
 *
 * ADR-0029's design, finished. The server put the durable credential where
 * JavaScript cannot reach it; this store is the client refusing to undo that
 * by writing its half somewhere durable. **No access token, no CSRF token and
 * no principal is ever written to `localStorage`, `sessionStorage` or a cookie
 * the client sets itself** (ADR-0033, amended D3.1) — anything a script can
 * read after the fact, an XSS reads too, and reducing what an XSS walks away
 * with was the whole trade of D2.5. The cost is paid in §Boot: a reload starts
 * empty and bootstraps.
 *
 * The two tokens are separate fields because they exist at different moments —
 * after ADR-0030's bootstrap the store holds a CSRF token and no access token,
 * and that intermediate state is exactly what the boot sequence passes through.
 *
 * The principal lives here by decision: `AuthResource` carries it on both login
 * and refresh, and it is session identity — who is signed in — not server
 * state, so it belongs here rather than in the query cache (ADR-0034 owns
 * that). Richer or fresher account data is a `/profile` query like any other.
 *
 * `subscribe` exists because two things observe this and the store knows about
 * neither: the ADR-0032 router guard, which must answer "authenticated?" before
 * a protected route renders, and React, through `useSyncExternalStore`.
 */

export interface SessionSnapshot {
  readonly accessToken: string | null;
  readonly csrfToken: string | null;
  readonly principal: PrincipalResource | null;
}

export interface SessionPatch {
  readonly accessToken?: string;
  readonly csrfToken?: string;
  readonly principal?: PrincipalResource;
}

const EMPTY: SessionSnapshot = Object.freeze({
  accessToken: null,
  csrfToken: null,
  principal: null,
});

export const createSessionStore = () => {
  /*
   * One frozen object rather than three variables, so `getSnapshot` can return
   * a stable reference. `useSyncExternalStore` re-renders whenever the snapshot
   * is not `Object.is`-equal to the last one, so a fresh object per read would
   * be an infinite render loop — the standard trap, avoided by construction
   * rather than by remembering.
   */
  let snapshot: SessionSnapshot = EMPTY;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: (): SessionSnapshot => snapshot,
    getAccessToken: () => snapshot.accessToken,
    getCsrfToken: () => snapshot.csrfToken,
    getPrincipal: () => snapshot.principal,

    /** The access token's presence *is* the authenticated state. */
    isAuthenticated: () => snapshot.accessToken !== null,

    setSession: (patch: SessionPatch): void => {
      snapshot = Object.freeze({
        accessToken: patch.accessToken ?? snapshot.accessToken,
        csrfToken: patch.csrfToken ?? snapshot.csrfToken,
        principal: patch.principal ?? snapshot.principal,
      });
      notify();
    },

    clear: (): void => {
      snapshot = EMPTY;
      notify();
    },

    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } as const;
};

export type SessionStore = ReturnType<typeof createSessionStore>;
