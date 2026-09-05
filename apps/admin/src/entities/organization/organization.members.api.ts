import type {
  AddMembershipBody,
  ListEnvelope,
  ListMembershipsQuery,
  MembershipResource,
  OrganizationRole,
  Page,
} from "@repo/contracts";

import type { ApiClient } from "@/shared/api/client";

/**
 * The memberships sub-resource of `/admin/organizations/:id` (ADR-0067 §3), as
 * plain typed functions.
 *
 * A **sub-resource**, and the first one in this app: its rows belong to one
 * organization and have no life of their own, so every function here takes the
 * organization id first, exactly as the endpoint's path does. There is no
 * `entities/membership` slice, and that is the decision rather than an
 * omission — an entity slice is a thing with its own list screen, its own
 * routes and its own record, and a membership has none of the three. It is a
 * second file in the organization's slice for the same reason the endpoints
 * are a second router under the organization's path.
 *
 * The four operations are all of them (`D15.4`): list, add by user id, change
 * a role, remove. There is deliberately no "get one" — nothing addresses a
 * single membership, the pair being its whole identity.
 */
export const createOrganizationMembersApi = (client: ApiClient) =>
  ({
    list: async (
      organizationId: string,
      params: ListMembershipsQuery,
    ): Promise<Page<MembershipResource>> => {
      const { data } = await client.instance.get<
        ListEnvelope<MembershipResource>
      >(`/organizations/${organizationId}/memberships`, { params });

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
     * By **user id**, not by address (ADR-0067 §3): staff already list
     * accounts, so there is nothing here to enumerate — and the invitation
     * flow, which does name an address, is the customer segment's.
     *
     * `204`, so nothing is returned: the section refetches its list, which is
     * what it would have to do anyway to see the row in its sorted place.
     */
    add: async (
      organizationId: string,
      body: AddMembershipBody,
    ): Promise<void> => {
      await client.instance.post(
        `/organizations/${organizationId}/memberships`,
        body,
      );
    },

    setRole: async (
      organizationId: string,
      userId: string,
      role: OrganizationRole,
    ): Promise<void> => {
      await client.instance.patch(
        `/organizations/${organizationId}/memberships/${userId}`,
        { role },
      );
    },

    remove: async (organizationId: string, userId: string): Promise<void> => {
      await client.instance.delete(
        `/organizations/${organizationId}/memberships/${userId}`,
      );
    },
  }) as const;

export type OrganizationMembersApi = ReturnType<
  typeof createOrganizationMembersApi
>;
