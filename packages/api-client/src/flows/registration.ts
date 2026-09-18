import type {
  AcceptedResource,
  AuthResource,
  ConfirmEmailBody,
  RegisterBody,
  ResendVerificationBody,
  VerifyEmailBody,
} from "@repo/contracts";

import type { FlowDeps } from "./deps";

/**
 * Signing up, and the address changes that follow (ADR-0067 §6, ADR-0071
 * §§3, 6).
 *
 * Split out of `client.ts` at `D20.7`, verbatim. All four are on
 * `/api/v1/public` by way of the per-request `baseURL` override registration
 * established, because the caller may have no population yet — which is the
 * property that puts them in this package at all rather than in an app's own
 * entity slice.
 */
export const createRegistrationFlows = ({
  instance,
  store,
  publicBaseUrl,
  requireUserSegment,
}: FlowDeps) => {
  /**
   * Registers an account (`D15.6`, ADR-0067 §6; ADR-0071 §3 for the answer).
   *
   * **It starts no session, and that is the point.** Registration answered
   * `201` with login's body until ADR-0071 §3; it now answers `202` and issues
   * nothing, because an address nobody has proven is not an account anybody
   * may be signed into. What signs a device in is the confirmation link, which
   * arrives in a mailbox and lands on the app's own confirmation route — whose
   * client call belongs to the step that builds that screen.
   *
   * So this writes **nothing** to the store, and writing nothing is the whole
   * of the change. Hydrating from a `202` would put `undefined` where the
   * access token and the principal go, which is not "no session" but a broken
   * one — a shape the boot sequence has no branch for, on a client that would
   * then believe it was signed in.
   *
   * It still lives here, beside `login`, because the segment rule below is
   * about this package's own memory and is unchanged by the answer.
   *
   * **The first call in this package that left its segment, and it says so in
   * one place.** Registration is mounted on `/api/v1/public` (ADR-0015): it is
   * the endpoint for somebody who has no population yet, so it cannot live
   * under `/user`, and the base URL this client is pinned to would send it to
   * a path that does not exist. The override is per request and the path stays
   * relative, so the path-keyed rules still apply — the CSRF list and
   * {@link COOKIE_TRANSPORT_PATHS} match on the request's own `url` rather
   * than on the resolved address — and the override itself is fenced to this
   * client's own host by the interceptor, which grew that check for this call
   * (`D15.6`, `security-reviewer`). ADR-0071 §3's confirmation pair are the
   * second and third, on the same override.
   *
   * **A `user`-segment call, refused on any other client** — see
   * {@link requireUserSegment}, which is where this file reads its own
   * segment. Unlike `redeemHandoff`,
   * which is a `404` by construction because the API registers that route on
   * one segment only, this endpoint is public by design and would answer
   * anybody. What would be wrong is not the request but the write — a `user`
   * principal hydrated into the store an admin app's guards read — and the
   * server has nothing to say about it, so the check has to be here. It is a
   * guard on **this client's own population**, which this factory was handed,
   * rather than a second opinion about the API's.
   *
   * The endpoint exists only when `FEATURE_USER_REGISTRATION` is on; with it
   * off the path answers `404 ROUTE_NOT_FOUND` rather than a `403` that would
   * confirm the feature (ADR-0004), and that code reaches the caller as any
   * other refusal does.
   */
  const register = async (body: RegisterBody): Promise<void> => {
    requireUserSegment("Registration");

    await instance.post<{ data: AcceptedResource }>("/auth/register", body, {
      baseURL: publicBaseUrl,
    });
  };

  /**
   * Turns a confirmation link into a session (ADR-0071 §3).
   *
   * **`register`'s other half, and the one that actually signs a device in.**
   * The endpoint consumes the single-use token, makes the account `active`
   * with its address stamped proven, and answers **login's body** — so this
   * writes the store for `login`'s own reason: the module that owns the
   * session's memory is the one that writes it, and a feature that hydrated it
   * would be a second writer of the state this package exists to keep to one.
   * The `/verify-email` screen therefore hands over a token and gets an
   * `AuthResource` back, exactly as the sign-in form does.
   *
   * The token is the credential and the request is unauthenticated, which
   * {@link UNAUTHENTICATED_PATHS} makes true rather than merely states: a
   * browser that already holds somebody's session must not put that bearer on
   * the one request whose whole job is to replace it. The request interceptor
   * has asked for cookie transport ({@link COOKIE_TRANSPORT_PATHS}), so
   * `refreshToken` is absent from the response and `csrfToken` is present
   * (ADR-0029 §Opt-in) — the same shape login gets, and without it the account
   * is signed in until the first reload with its one link already spent.
   *
   * Every way it can fail answers one indistinguishable `401` (ADR-0071 §3),
   * so there is nothing here to branch on and it does not try to. The store is
   * written only on success: a refused confirmation leaves whatever session
   * the browser had exactly as it was, rather than half-writing over it.
   *
   * **A `user`-segment call for `register`'s reason exactly**, and refused on
   * any other client. The route is mounted on `/api/v1/public` and would
   * answer anybody; what would be wrong is the *write* — a `user` principal
   * hydrated into the store an admin app's guards read — and the server has
   * nothing to say about it, so the check has to be here.
   */
  const verifyEmail = async (token: string): Promise<AuthResource> => {
    requireUserSegment("Address verification");

    const body: VerifyEmailBody = { token };
    const { data } = await instance.post<{ data: AuthResource }>(
      "/auth/verify-email",
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

  /**
   * Asks for the confirmation link again (ADR-0071 §3).
   *
   * **No segment guard, and its absence is the decision.** The two guards
   * above are about this package's *memory* — they exist because a `user`
   * principal must not be hydrated into an admin app's store — and this call
   * writes nothing at all. It answers `202` for every address, known or not
   * (ADR-0020 §Enumeration), so there is no resource to be handed to the wrong
   * client either. Guarding it would be a check with no failure to prevent.
   *
   * The locale travels in the body because no account is known to be acting:
   * the answer must not depend on whether an address has one, so the server
   * cannot look up a stored locale to write in (ADR-0071 §2, ADR-0046).
   */
  const resendVerification = async (
    body: ResendVerificationBody,
  ): Promise<void> => {
    await instance.post<{ data: AcceptedResource }>(
      "/auth/resend-verification",
      body,
      { baseURL: publicBaseUrl },
    );
  };

  /**
   * Spends an address-change link, so the new address becomes the account's
   * (ADR-0071 §6).
   *
   * **It writes nothing to the store and it is right not to.** Compare its two
   * neighbours: `verifyEmail` writes a session because the endpoint issues
   * one, and `resetPassword` clears the store because the endpoint revokes
   * every session there is. This endpoint does neither — §6 leaves sessions
   * untouched, an address not being a credential — so the honest client
   * behaviour is to leave the browser exactly as it found it.
   *
   * What that costs is a stale `email` on the principal in memory, in the one
   * case where the link happens to be opened in the browser already signed
   * into the account it belongs to. It is the screen's to deal with rather
   * than this function's: the endpoint answers `204` with no principal, so
   * there is nothing here to rebuild one from, and the store's rule is that it
   * is written from a response that carries a session (`D3.9`'s single-writer
   * finding). The customer app's `/confirm-email` screen invalidates the
   * profile query instead, which is what every account screen reads the
   * address from; the header's account control catches up at the next token
   * rotation, and the case only arises at all when the link happens to be
   * opened in a browser signed into the account that moved.
   *
   * **No segment guard**, for `resendVerification`'s reason: the two guards on
   * this client exist because a `user` principal must not be hydrated into an
   * admin app's store, and this writes nothing at all.
   *
   * Every way the link can be bad answers one indistinguishable `401`, with
   * the single exception §6 makes on purpose — `409 USER_EMAIL_TAKEN`, when
   * somebody claimed the address in the meantime — so there is exactly one
   * thing here worth branching on and the screen does the branching.
   */
  const confirmEmail = async (token: string): Promise<void> => {
    const body: ConfirmEmailBody = { token };

    await instance.post("/auth/confirm-email", body, {
      baseURL: publicBaseUrl,
    });
  };

  return { register, verifyEmail, resendVerification, confirmEmail } as const;
};
