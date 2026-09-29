import type { ApiClient } from "@repo/api-client";
import type { SuccessEnvelope } from "@repo/contracts";

import type { AccountSettings, AccountSettingsPatch } from "./settings.types";

/**
 * `/api/v1/<segment>/settings` as plain typed functions (ADR-0043 §Entity API,
 * ADR-0045 §Endpoints).
 *
 * The segment is the client's: the admin's is pinned to `/admin` and the
 * customer's to `/user` (ADR-0015), so the one path below is the right
 * endpoint in either app and this file names neither population.
 *
 * A singleton with no `:id`: the subject is `ctx.principal`, which is why the
 * routers mount it with no `authorize` at all and why there is no parameter
 * here for a caller to point at somebody else's row.
 */
export const createSettingsApi = (client: ApiClient) =>
  ({
    get: async (): Promise<AccountSettings> => {
      const { data } =
        await client.instance.get<SuccessEnvelope<AccountSettings>>(
          "/settings",
        );

      return data.data;
    },

    /**
     * `PATCH /settings` — a **merge**, not a replacement.
     *
     * `theme`, `locale` and `gridDensity` replace when present; `grids` is
     * applied entry by entry, with `null` deleting a key and an absent key
     * untouched. That is what makes a body a statement about the keys it
     * names and silence about the rest, and it is the property the coalescing
     * writer depends on: it sends only what changed, and two tabs patching
     * different grids both land (ADR-0045 §Endpoints).
     *
     * The response is the full resource after the merge, so the caller can
     * reconcile rather than assume.
     */
    update: async (body: AccountSettingsPatch): Promise<AccountSettings> => {
      const { data } = await client.instance.patch<
        SuccessEnvelope<AccountSettings>
      >("/settings", body);

      return data.data;
    },
  }) as const;

export type SettingsApi = ReturnType<typeof createSettingsApi>;
