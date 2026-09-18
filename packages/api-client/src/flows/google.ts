import type {
  AuthResource,
  FederatedExchangeBody,
  FederatedStartBody,
  FederatedStartResource,
} from "@repo/contracts";

import type { FlowDeps } from "./deps";

/**
 * Signing in with Google (ADR-0072 §2).
 *
 * Split out of `client.ts` at `D20.7`, verbatim. The start and the exchange
 * are the two ends of one round trip through the provider — the callback in
 * between is a navigation from Google to the API and never passes through this
 * client — and both are on the public segment, because a person signing in
 * this way may have no account here yet.
 */
export const createGoogleFlows = ({
  instance,
  store,
  publicBaseUrl,
  requireUserSegment,
}: FlowDeps) => {
  /**
   * Starts a sign-in with Google (ADR-0072 §2).
   *
   * **An XHR, not a navigation, and that is the whole reason the endpoint is a
   * `POST`.** A `GET` that redirected would be a link anyone could plant to
   * start a flow in somebody's browser; this request carries a JSON body, which
   * forces a cross-origin preflight the API answers only for its own origins,
   * and the API refuses anything that is not `application/json` (§2 as amended
   * at `D19.2`). axios sends an object body as JSON, so the property holds by
   * construction here rather than by a header this function sets.
   *
   * The answer is the provider's authorization URL; the response also sets the
   * transaction cookie on the API's origin, which is what binds the callback to
   * this browser. This function **navigates nowhere** — a client that does not
   * know what a route is does not know what a window is either — and the
   * caller assigns the URL.
   *
   * **No segment guard**, for `resendVerification`'s reason: the two guards on
   * this client exist because a `user` principal must not be hydrated into an
   * admin app's store, and this writes nothing to the store at all.
   *
   * The routes exist only where the API is given a Google client (§2), so an
   * API without one answers `404 ROUTE_NOT_FOUND`, which reaches the caller as
   * any other refusal does.
   */
  const startGoogleSignIn = async (
    body: FederatedStartBody,
  ): Promise<FederatedStartResource> => {
    const { data } = await instance.post<{ data: FederatedStartResource }>(
      "/auth/google/start",
      body,
      { baseURL: publicBaseUrl },
    );

    return data.data;
  };

  /**
   * Spends the Google callback's handoff for a session (ADR-0072 §2).
   *
   * `verifyEmail`'s shape, inherited whole: the endpoint answers **login's
   * body**, so this writes the store for `login`'s own reason, and the request
   * is unauthenticated — the token is the credential, so
   * {@link UNAUTHENTICATED_PATHS} keeps whoever already had this browser off
   * it — on cookie transport ({@link COOKIE_TRANSPORT_PATHS}).
   *
   * **It must travel with credentials, and it does because every request on
   * this instance does** (`withCredentials: true` above). The exchange is bound
   * to the browser the callback answered (§2 as amended at `D19.2`): the
   * callback leaves a handoff binding in `__Host-<APP_ID>.oidc` on the API's
   * origin, and the endpoint refuses, with its one `401`, a token the cookie
   * does not name. A request sent without the browser's cookies would carry no
   * binding, and every sign-in would answer `401` — which is why the suite
   * asserts the request's credentials mode rather than trusting the default.
   *
   * **A `user`-segment call for `verifyEmail`'s reason**, and refused on any
   * other client: the route is public and would answer anybody, and what would
   * be wrong is the *write*. The store is written only on success; a refused
   * exchange leaves whatever session the browser had exactly as it was.
   */
  const exchangeGoogleSignIn = async (token: string): Promise<AuthResource> => {
    requireUserSegment("Signing in with Google");

    const body: FederatedExchangeBody = { token };
    const { data } = await instance.post<{ data: AuthResource }>(
      "/auth/google/exchange",
      body,
      { baseURL: publicBaseUrl },
    );
    const resource = data.data;

    store.setSession({
      accessToken: resource.accessToken,
      principal: resource.principal,
      ...(resource.csrfToken ? { csrfToken: resource.csrfToken } : {}),
    });

    return resource;
  };

  return { startGoogleSignIn, exchangeGoogleSignIn } as const;
};
