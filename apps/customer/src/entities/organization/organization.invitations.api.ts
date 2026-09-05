import type {
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
 * **Nothing here carries a token.** The row's `token_hash` is minted by the API
 * and read by nothing in D15 (ADR-0067 §2 as amended): acceptance matches by
 * address, because nothing in this deliverable can deliver a token. The mail
 * deliverable adds the link; this client needs no change for it.
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

    /** `POST /user/invitations/:id/decline` — `204`. Ends an offer, joins nothing. */
    decline: async (id: string): Promise<void> => {
      await client.instance.post(`/invitations/${id}/decline`, {});
    },
  }) as const;

export type MyInvitationsApi = ReturnType<typeof createMyInvitationsApi>;
