import type {
  CreateOrganizationAdminBody,
  ListEnvelope,
  ListOrganizationsQuery,
  Page,
  SuccessEnvelope,
  UpdateOrganizationBody,
  OrganizationResource,
} from "@repo/contracts";

import type { ApiClient } from "@/shared/api/client";

/**
 * The organizations endpoints as plain typed functions (ADR-0034 §Entity API).
 *
 * Deliberately not hooks. The split is what lets ADR-0036 test them without a
 * React tree, what lets a route loader call `ensureQueryData` with the same
 * function the hook uses, and what lets a bulk fan-out call one function N
 * times instead of mounting N hooks.
 *
 * The envelope arrives whole: ADR-0012 emits `meta.pagination`, `meta.sort` and
 * `meta.filters` precisely so a table can render its own state without
 * re-parsing its own query, and unwrapping a list to a bare array would throw
 * that away.
 */
export const createOrganizationsApi = (client: ApiClient) =>
  ({
    list: async (
      params: ListOrganizationsQuery,
    ): Promise<Page<OrganizationResource>> => {
      const { data } = await client.instance.get<
        ListEnvelope<OrganizationResource>
      >("/organizations", { params });

      return {
        items: data.data,
        total: data.meta.pagination.total,
        offset: data.meta.pagination.offset,
        limit: data.meta.pagination.limit,
        sort: data.meta.sort ?? [],
        filters: data.meta.filters ?? {},
      };
    },

    get: async (id: string): Promise<OrganizationResource> => {
      const { data } = await client.instance.get<
        SuccessEnvelope<OrganizationResource>
      >(`/organizations/${id}`);

      return data.data;
    },

    create: async (
      body: CreateOrganizationAdminBody,
    ): Promise<OrganizationResource> => {
      const { data } = await client.instance.post<
        SuccessEnvelope<OrganizationResource>
      >("/organizations", body);

      return data.data;
    },

    update: async (
      id: string,
      body: UpdateOrganizationBody,
    ): Promise<OrganizationResource> => {
      const { data } = await client.instance.patch<
        SuccessEnvelope<OrganizationResource>
      >(`/organizations/${id}`, body);

      return data.data;
    },

    remove: async (id: string): Promise<void> => {
      await client.instance.delete(`/organizations/${id}`);
    },
  }) as const;

export type OrganizationsApi = ReturnType<typeof createOrganizationsApi>;
