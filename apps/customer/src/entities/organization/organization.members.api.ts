import type {
  ListEnvelope,
  ListMembershipsQuery,
  MembershipResource,
  OrganizationRole,
  Page,
} from "@repo/contracts";

import type { ApiClient } from "@/shared/api/client";

/**
 * The members of one organization, `/api/v1/user/orgs/:orgId/members`
 * (ADR-0067 §4).
 *
 * A **sub-resource**: its rows belong to one tenant and have no life of their
 * own, so every function takes the organization id first, exactly as the path
 * does. There is no `entities/membership` slice, and that is a decision rather
 * than an omission — an entity slice is a thing with its own list screen, its
 * own routes and its own record, and a membership has none of the three.
 *
 * **Three operations where the admin's sub-resource has four**, and the missing
 * one is `add`: on this segment a second member arrives by invitation and never
 * by being named (ADR-0067 §2), because a customer naming an account id would
 * be an enumeration surface the invitation flow exists to avoid.
 *
 * `remove` is both removal and **leaving**. The API deliberately keeps them one
 * write with one invariant — the last owner may do neither — and only the
 * question of who was allowed to ask differs, which the route's guard answers
 * (`organizations.routes.ts`). A client that had two functions here would be
 * inventing a distinction the endpoint does not make.
 */
export const createOrganizationMembersApi = (client: ApiClient) =>
  ({
    list: async (
      organizationId: string,
      params: ListMembershipsQuery,
    ): Promise<Page<MembershipResource>> => {
      const { data } = await client.instance.get<
        ListEnvelope<MembershipResource>
      >(`/orgs/${organizationId}/members`, { params });

      return {
        items: data.data,
        total: data.meta.pagination.total,
        offset: data.meta.pagination.offset,
        limit: data.meta.pagination.limit,
        sort: data.meta.sort ?? [],
        filters: data.meta.filters ?? {},
      };
    },

    /** `PATCH .../members/:userId` — an owner only, because granting `owner` is
     * how ownership moves (ADR-0067 §2). `204`. */
    setRole: async (
      organizationId: string,
      userId: string,
      role: OrganizationRole,
    ): Promise<void> => {
      await client.instance.patch(`/orgs/${organizationId}/members/${userId}`, {
        role,
      });
    },

    /** `DELETE .../members/:userId` — removal, or the caller's own exit. `204`. */
    remove: async (organizationId: string, userId: string): Promise<void> => {
      await client.instance.delete(`/orgs/${organizationId}/members/${userId}`);
    },
  }) as const;

export type OrganizationMembersApi = ReturnType<
  typeof createOrganizationMembersApi
>;
