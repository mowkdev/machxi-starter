import type {
  SuccessEnvelope,
  UpdateUserSettingsBody,
  UserSettingsResource,
} from "@repo/contracts";

import type { ApiClient } from "@/shared/api/client";

/**
 * `/api/v1/user/settings` as plain typed functions (ADR-0043 §Entity API,
 * ADR-0045 §Endpoints).
 *
 * The **user** half of the contracts pair. `@repo/contracts` wrote that pair at
 * D6 with a sentence naming this day — "`apps/customer` consumes
 * `UserSettingsResource` through the identical shape on `/user`" — so the two
 * exports are two names for one shape today, and the split point is already
 * cut for the first setting one population has and the other does not.
 *
 * A singleton with no `:id`: the subject is `ctx.principal`, which is why the
 * router mounts it with no `authorize` at all (`apps/api/src/routes/user.router.ts`)
 * and why there is no parameter here for a caller to point at somebody else's
 * row.
 */
export const createSettingsApi = (client: ApiClient) =>
  ({
    get: async (): Promise<UserSettingsResource> => {
      const { data } =
        await client.instance.get<SuccessEnvelope<UserSettingsResource>>(
          "/settings",
        );

      return data.data;
    },

    /**
     * `PATCH /user/settings` — a **merge**, not a replacement.
     *
     * `theme`, `locale` and `gridDensity` replace when present and are
     * untouched when absent, which is what makes a body a statement about the
     * keys it names and silence about the rest (ADR-0045 §Endpoints). It is
     * also the property the coalescing writer depends on: it sends only what
     * changed.
     *
     * `grids` is the fourth key and this app never sends one — ADR-0055 §3
     * keeps `@repo/grid` out until a domain entity arrives, so there is no
     * arrangement to store. The body type still carries it, because the schema
     * is the segment's rather than this app's.
     *
     * The response is the full resource after the merge, so the caller can
     * reconcile rather than assume.
     */
    update: async (
      body: UpdateUserSettingsBody,
    ): Promise<UserSettingsResource> => {
      const { data } = await client.instance.patch<
        SuccessEnvelope<UserSettingsResource>
      >("/settings", body);

      return data.data;
    },
  }) as const;

export type SettingsApi = ReturnType<typeof createSettingsApi>;
