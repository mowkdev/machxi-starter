import type { AuthResource, ImpersonateBody, LoginBody } from "@repo/contracts";

import type { FlowDeps } from "./deps";

/**
 * The three calls that start or end a session with a credential this browser
 * already holds (ADR-0033, ADR-0057 §3) — sign in, sign out, and the
 * impersonation exchange.
 *
 * Split out of `client.ts` at `D20.7`, verbatim. They are together because
 * they are the same sentence said three ways: a response whose whole purpose
 * is to start a session is written to the store by the module that owns the
 * session's memory, never by the feature that asked for it.
 */
export const createSignInFlows = ({
  instance,
  store,
  endSession,
}: FlowDeps) => {
  /**
   * Signs in and hydrates the store.
   *
   * It lives here rather than in the login feature for the same reason
   * `refreshSession` does: this response's whole purpose is to start a session,
   * and the module that owns the session's memory is the one that should write
   * it. A feature that hydrated the store itself would be a second writer.
   *
   * The request interceptor has already asked for cookie transport, so
   * `refreshToken` is absent from the body by design and `csrfToken` is
   * present (ADR-0029 §Opt-in).
   */
  const login = async (credentials: LoginBody): Promise<AuthResource> => {
    const { data } = await instance.post<{ data: AuthResource }>(
      "/auth/login",
      credentials,
    );
    const resource = data.data;

    store.setSession({
      accessToken: resource.accessToken,
      principal: resource.principal,
      ...(resource.csrfToken ? { csrfToken: resource.csrfToken } : {}),
    });

    return resource;
  };

  /**
   * Redeems an impersonation handoff token for a session (`D13.7`,
   * ADR-0057 §3, §7).
   *
   * **It lives here, beside `login`, for `login`'s own reason**: this
   * response's whole purpose is to start a session, and the module that owns
   * the session's memory is the one that writes it. A feature that hydrated
   * the store itself would be a second writer of the state this package keeps
   * to one — the rule the D3.9 review wrote down and `useSetPrincipal` is the
   * single narrow exception to. The `/impersonate` screen therefore hands over
   * a token and gets an `AuthResource` back, exactly as the sign-in form does.
   *
   * The token is the credential and the request is unauthenticated, so nothing
   * in the store is read on the way out — which is true because
   * {@link UNAUTHENTICATED_PATHS} makes it true, and was false by one line
   * until `D13.7`'s review. The request interceptor has already asked for
   * cookie transport, so `refreshToken` is absent from the response and
   * `csrfToken` is present (ADR-0029 §Opt-in) — the same shape login gets.
   *
   * **On an `admin`-segment client this function is a `404` by construction**,
   * and that is the server's property rather than a check here: `auth.routes.ts`
   * registers the route only when the factory's population is `user`, because
   * an admin-segment twin would be a way to turn a URL fragment into a staff
   * session (ADR-0057 §3). A guard on `segment` in this file would be a second
   * implementation of a rule the authority already enforces, and the weaker of
   * the two; it is named here so a reader does not conclude the symbol's
   * presence on both clients means the endpoint exists on both.
   *
   * Every failure the endpoint has answers one indistinguishable `401`
   * (ADR-0057 §3), which is a code an already-shipped bundle renders without
   * any change; there is nothing for this function to branch on, and it does
   * not try to.
   *
   * The store is written only on success. A refused exchange leaves whatever
   * session the browser already had exactly as it was — the pre-existing real
   * customer session ADR-0057 §3 declines to disturb — rather than half-writing
   * an identity over it.
   */
  const redeemHandoff = async (token: string): Promise<AuthResource> => {
    const body: ImpersonateBody = { token };
    const { data } = await instance.post<{ data: AuthResource }>(
      "/auth/impersonate",
      body,
    );
    const resource = data.data;

    store.setSession({
      accessToken: resource.accessToken,
      principal: resource.principal,
      ...(resource.csrfToken ? { csrfToken: resource.csrfToken } : {}),
    });

    return resource;
  };

  /**
   * Ends the session on the server, then locally.
   *
   * The local clear is unconditional, including when the request fails: a
   * client that cannot reach the API must still end what it controls, and the
   * server-side session — unreachable in that moment — dies at its TTL or at
   * reuse detection, which is the best an offline logout can do (ADR-0033).
   */
  const logout = async (): Promise<void> => {
    try {
      await instance.post("/auth/logout");
    } finally {
      endSession();
    }
  };

  return { login, redeemHandoff, logout } as const;
};
