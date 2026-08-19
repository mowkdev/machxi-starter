import type {
  CreateStaffBody,
  ListEnvelope,
  ListStaffQuery,
  Page,
  StaffResource,
  SuccessEnvelope,
  UpdateStaffBody,
} from "@repo/contracts";

import type { ApiClient } from "@/shared/api/client";
import { toListParams } from "@/shared/api/list-params";

/**
 * The staff endpoints as plain typed functions (ADR-0034 §Entity API).
 *
 * Deliberately not hooks. The split is what lets ADR-0036 test them without a
 * React tree, and what lets a route loader call `ensureQueryData` with the same
 * function the hook uses.
 *
 * The envelope arrives whole: ADR-0012 emits `meta.pagination`, `meta.sort` and
 * `meta.filters` precisely so a table can render its own state without
 * re-parsing its own query, and unwrapping a list to a bare array would throw
 * that away. `list` reassembles it into the `Page<T>` contracts already define.
 */
export const createStaffApi = (client: ApiClient) =>
  ({
    list: async (params: ListStaffQuery): Promise<Page<StaffResource>> => {
      const { data } = await client.instance.get<ListEnvelope<StaffResource>>(
        "/staff",
        { params: toListParams(params) },
      );

      return {
        items: data.data,
        total: data.meta.pagination.total,
        offset: data.meta.pagination.offset,
        limit: data.meta.pagination.limit,
        sort: data.meta.sort ?? [],
        filters: data.meta.filters ?? {},
      };
    },

    get: async (id: string): Promise<StaffResource> => {
      const { data } = await client.instance.get<
        SuccessEnvelope<StaffResource>
      >(`/staff/${id}`);

      return data.data;
    },

    create: async (body: CreateStaffBody): Promise<StaffResource> => {
      const { data } = await client.instance.post<
        SuccessEnvelope<StaffResource>
      >("/staff", body);

      return data.data;
    },

    update: async (
      id: string,
      body: UpdateStaffBody,
    ): Promise<StaffResource> => {
      const { data } = await client.instance.patch<
        SuccessEnvelope<StaffResource>
      >(`/staff/${id}`, body);

      return data.data;
    },

    remove: async (id: string): Promise<void> => {
      await client.instance.delete(`/staff/${id}`);
    },
  }) as const;

export type StaffApi = ReturnType<typeof createStaffApi>;
