import type {
  AcceptOnboardingBody,
  AuthResource,
  InvitationLookupResource,
  LookupInvitationBody,
} from "@repo/contracts";

import { TRANSPORT_ERROR_CODE, apiClientError } from "../api-error";

import type { FlowDeps } from "./deps";

/**
 * The invitation link, read and then spent (ADR-0071 §§5, 8).
 *
 * Split out of `client.ts` at `D20.7`, verbatim. The two halves are the same
 * link at two moments — the screen reads what is being offered before anybody
 * is signed in, and accepts it with a chosen password — which is why they are
 * one file even though only the lookup leaves its segment.
 */
export const createInvitationFlows = ({
  instance,
  store,
  segment,
  publicBaseUrl,
}: FlowDeps) => {
  /**
   * Reads what an invitation link is offering, before there is a session
   * (ADR-0071 §5).
   *
   * **It lives in this package rather than in an app's entity slice because of
   * the segment it is on.** The route is mounted on `/api/v1/public` — the
   * caller is whoever opened the mail, who may have no account at all — and an
   * app reaches only its own segment through `client.instance`. That is
   * `register`'s and the verification pair's situation exactly, and this is
   * where those three live.
   *
   * **No segment guard, for `resendVerification`'s reason.** The two guards on
   * this client are about its *memory*: they exist because a `user` principal
   * must not be hydrated into an admin app's store. This writes nothing at
   * all, and the answer it returns is the same answer the endpoint gives
   * anybody holding the token, so there is no resource to be handed to the
   * wrong client either.
   *
   * The token is the credential and it is the whole of the authority: the
   * answer carries the organization's name, the invited address and the role
   * and deliberately no invitation id (ADR-0071 §5), because an id would be
   * authority for the *other* accept path — the one scoped by address alone.
   *
   * Unknown, accepted, declined, revoked, expired and "its organization was
   * deleted" are one indistinguishable `404`, so there is nothing here to
   * branch on and it does not try to.
   */
  const lookupInvitation = async (
    token: string,
  ): Promise<InvitationLookupResource> => {
    const body: LookupInvitationBody = { token };
    const { data } = await instance.post<{ data: InvitationLookupResource }>(
      "/invitations/lookup",
      body,
      { baseURL: publicBaseUrl },
    );

    return data.data;
  };

  /**
   * Turns an onboarding link and a chosen password into a session (ADR-0071
   * §8).
   *
   * **`verifyEmail`'s twin on the other population**, and it writes the store
   * for `login`'s own reason: the endpoint answers login's body, and the
   * module that owns the session's memory is the one that writes it. A feature
   * that hydrated it would be a second writer of the state this package exists
   * to keep to one.
   *
   * The token is the credential and the request is unauthenticated, which
   * {@link UNAUTHENTICATED_PATHS} makes true rather than merely states: an
   * operator following this link may well be sitting in a browser already
   * signed in as somebody else, and that somebody's bearer has no business on
   * the request that replaces them. The interceptor has asked for cookie
   * transport ({@link COOKIE_TRANSPORT_PATHS}), so `refreshToken` is absent
   * from the response and `csrfToken` is present — the same shape login gets,
   * and without it the operator is signed in until the first reload with their
   * one link already spent.
   *
   * **An `admin`-segment call** — the URL segment, which is the `staff`
   * population (ADR-0015) — and refused on any other client for
   * {@link requireUserSegment}'s reason read the other way round. Unlike
   * `verifyEmail` the route really is registered on one segment only — the
   * customer client would get a `404` — but a `404` is a worse way to learn
   * this than a refusal that names the mistake, and the reason the check
   * exists is the *write*: a staff principal must never be hydrated into a
   * customer app's store.
   *
   * Every way it can fail answers one indistinguishable `401` (ADR-0071 §8),
   * so there is nothing here to branch on. The store is written only on
   * success: a refused accept leaves whatever session the browser had exactly
   * as it was.
   */
  const acceptOnboarding = async (
    body: AcceptOnboardingBody,
  ): Promise<AuthResource> => {
    if (segment !== "admin") {
      throw apiClientError({
        status: 0,
        code: TRANSPORT_ERROR_CODE,
        message: "Staff onboarding is an admin-segment call",
      });
    }

    const { data } = await instance.post<{ data: AuthResource }>(
      "/auth/onboarding/accept",
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

  return { lookupInvitation, acceptOnboarding } as const;
};
