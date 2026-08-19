/**
 * The session the router guards ask about — **a stub, and only until `D3.4`**.
 *
 * The address is ADR-0033's, deliberately: that ADR puts the token store at
 * `shared/api/session-store.ts` under these names, so `D3.4` replaces a body
 * rather than a path, and `__root.tsx` and `providers/router.tsx` do not have
 * to be rewired to gain real authentication.
 *
 * What it is not is ADR-0033's store. That one holds an access token, a CSRF
 * token and the principal in a closure, and never in `localStorage`. This holds
 * nothing: `D3.3` is explicitly "no data, no auth yet; guards stubbed to let
 * the shell render", and the point of having it at all is that the guard, the
 * router context type and the redirect all land here already exercised.
 */

export interface SessionStore {
  /** Whether a staff principal is currently signed in. */
  readonly isAuthenticated: () => boolean;
}

/**
 * Answers "signed in" unless the URL says otherwise, **in development only**.
 *
 * The `?anon` hatch exists because both guards are real: with an unconditional
 * `true`, `_auth`'s mirror redirect makes the login screen unreachable under
 * `pnpm dev`, and half of what this step builds could not be looked at.
 * `/login?anon` renders the `login-01` shell; everything else renders the
 * dashboard.
 *
 * `import.meta.env.DEV` is what keeps it out of a production bundle, because a
 * URL-controlled guard bypass is only harmless while nothing sits behind the
 * guard — and it stops being harmless the moment this module outlives its step.
 *
 * @todo `D3.4` replaces this with the ADR-0033 store and deletes the hatch.
 */
export const createSessionStore = (): SessionStore =>
  ({
    isAuthenticated: () =>
      !(import.meta.env.DEV && window.location.search.includes("anon")),
  }) as const;
