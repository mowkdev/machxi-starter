import type {
  StaffSettingsResource,
  SuccessEnvelope,
  UpdateStaffSettingsBody,
} from "@repo/contracts";

import type { ApiClient } from "@/shared/api/client";

/**
 * `/api/v1/admin/settings` as plain typed functions (ADR-0043 §Entity API,
 * ADR-0045 §Endpoints).
 *
 * The **staff** half of the contracts pair, because this app talks to the admin
 * segment and nothing else can answer here (ADR-0015). `apps/customer` (D8)
 * consumes `UserSettingsResource` through the identical shape on `/user`; the
 * pair exists so that the day one population's settings grow a field, one of
 * the two slices changes and the other does not.
 *
 * A singleton with no `:id`: the subject is `ctx.principal`, which is why the
 * router mounts with no `authorize` at all and why there is no parameter here
 * for a caller to point at somebody else's row.
 */
export const createSettingsApi = (client: ApiClient) =>
  ({
    get: async (): Promise<StaffSettingsResource> => {
      const { data } =
        await client.instance.get<SuccessEnvelope<StaffSettingsResource>>(
          "/settings",
        );

      return data.data;
    },

    /**
     * `PATCH /admin/settings` — a **merge**, not a replacement.
     *
     * `theme` and `locale` replace when present; `grids` is applied entry by
     * entry, with `null` deleting a key and an absent key untouched. That is
     * what makes a body a statement about the keys it names and silence about
     * the rest, and it is the property the coalescing writer depends on: it
     * sends only what changed, and two tabs patching different grids both land
     * (ADR-0045 §Endpoints).
     *
     * The response is the full resource after the merge, so the caller can
     * reconcile rather than assume.
     */
    update: async (
      body: UpdateStaffSettingsBody,
    ): Promise<StaffSettingsResource> => {
      const { data } = await client.instance.patch<
        SuccessEnvelope<StaffSettingsResource>
      >("/settings", body);

      return data.data;
    },
  }) as const;

export type SettingsApi = ReturnType<typeof createSettingsApi>;
