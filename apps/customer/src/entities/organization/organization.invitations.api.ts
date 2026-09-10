import type {
  AcceptInvitationByTokenBody,
  CreateInvitationBody,
  InvitationResource,
  ListEnvelope,
  ListInvitationsQuery,
  OrganizationResource,
  Page,
  SuccessEnvelope,
} from "@repo/contracts";

import type { ApiClient } from "@/shared/api/client";

/**
 * Invitations, from both ends (ADR-0067 §2, §4).
 *
 * **Two factories and not one, because the two ends are two different scopes.**
 * An organization's pending list is addressed inside the `/orgs/:orgId` prefix
 * and is read by its owners and admins; the caller's *received* list is
 * addressed outside it, by nothing but the caller's own address, because an
 * invitee is not a member of anything yet — which is exactly what an invitation
 * is for. Sharing one factory would hide that difference behind a parameter.
 *
 * **One call here carries a token, and it is the only one** (`D18.8`,
 * ADR-0071 §5). Through D15 nothing did: the row's `token_hash` was minted by
 * the API and read by nobody (ADR-0067 §2 as amended), because acceptance
 * matched by address and no deliverable could deliver a link. The mail
 * deliverable delivers one, so `acceptByToken` joins the invitee's own
 * factory — and nothing else moved, because address-match acceptance is still
 * how an offer is taken from the account area's inbox.
 *
 * **The link's other half is not here**, and its absence is the segment rather
 * than an omission: `POST /public/invitations/lookup` is mounted outside this
 * app's `/user` prefix, so it lives in `@repo/api-client` beside `register`
 * and the verification pair, which are public for the same reason. It is also
 * the one call in the flow a person with no account at all can make.
 */
export const createOrganizationInvitationsApi = (client: ApiClient) =>
  ({
    /** `GET /user/orgs/:orgId/invitations` — the organization's pending ones. */
    list: async (
      organizationId: string,
      params: ListInvitationsQuery,
    ): Promise<Page<InvitationResource>> => {
      const { data } = await client.instance.get<
        ListEnvelope<InvitationResource>
      >(`/orgs/${organizationId}/invitations`, { params });

      return {
        items: data.data,
        total: data.meta.pagination.total,
        offset: data.meta.pagination.offset,
        limit: data.meta.pagination.limit,
        sort: data.meta.sort ?? [],
        filters: data.meta.filters ?? {},
      };
    },

    /**
     * `POST /user/orgs/:orgId/invitations` — by **address**, never by account
     * (ADR-0067 §2, ADR-0020 §Enumeration). `201`.
     *
     * Creating one looks no user up, so the answer is identical whether or not
     * the address has an account here — which is what makes the flow
     * enumeration-safe by construction rather than by a rule somebody keeps.
     */
    create: async (
      organizationId: string,
      body: CreateInvitationBody,
    ): Promise<InvitationResource> => {
      const { data } = await client.instance.post<
        SuccessEnvelope<InvitationResource>
      >(`/orgs/${organizationId}/invitations`, body);

      return data.data;
    },

    /** `DELETE /user/orgs/:orgId/invitations/:id` — revoke. `204`. */
    revoke: async (organizationId: string, id: string): Promise<void> => {
      await client.instance.delete(`/orgs/${organizationId}/invitations/${id}`);
    },
  }) as const;

export type OrganizationInvitationsApi = ReturnType<
  typeof createOrganizationInvitationsApi
>;

/**
 * `/api/v1/user/invitations` — the invitee's own three routes.
 *
 * Self-scoped like `/profile` and `/settings`: what selects these rows is the
 * caller's address, read from their account rather than from the request, so
 * there is nothing here for a caller to name but an invitation they were shown.
 */
export const createMyInvitationsApi = (client: ApiClient) =>
  ({
    list: async (): Promise<readonly InvitationResource[]> => {
      const { data } =
        await client.instance.get<SuccessEnvelope<InvitationResource[]>>(
          "/invitations",
        );

      return data.data;
    },

    /**
     * `POST /user/invitations/:id/accept` — `200` with the organization joined.
     *
     * The organization comes back rather than a `204`, because the client's
     * next act is to switch into it (`organizations.controller.ts`): what this
     * function returns is what the switcher would otherwise have to refetch to
     * learn.
     */
    accept: async (id: string): Promise<OrganizationResource> => {
      const { data } = await client.instance.post<
        SuccessEnvelope<OrganizationResource>
      >(`/invitations/${id}/accept`, {});

      return data.data;
    },

    /**
     * `POST /user/invitations/accept-by-token` — the mailed link, redeemed
     * (ADR-0071 §5). `200` with the organization joined, like {@link accept}.
     *
     * **The same answer as accepting by id, and a different authority.** There
     * the caller names a row their own address selected; here they present the
     * token out of the link's fragment, and the API joins them only when the
     * invited address is the one their session carries — the token proves the
     * mailbox, the session proves the account, and the two must agree. A
     * caller whose address differs is `403
     * ORGANIZATION_INVITATION_ADDRESS_MISMATCH` and the link is left unspent,
     * so it still works in the browser it was meant for.
     *
     * The token is a body field rather than a path segment for the reason
     * every flow in ADR-0071 §1 keeps: a single-use credential has no business
     * in a URL an access log or a proxy writes down.
     */
    acceptByToken: async (token: string): Promise<OrganizationResource> => {
      const body: AcceptInvitationByTokenBody = { token };
      const { data } = await client.instance.post<
        SuccessEnvelope<OrganizationResource>
      >("/invitations/accept-by-token", body);

      return data.data;
    },

    /** `POST /user/invitations/:id/decline` — `204`. Ends an offer, joins nothing. */
    decline: async (id: string): Promise<void> => {
      await client.instance.post(`/invitations/${id}/decline`, {});
    },
  }) as const;

export type MyInvitationsApi = ReturnType<typeof createMyInvitationsApi>;
