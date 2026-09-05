import type {
  CreateOrganizationBody,
  OrganizationResource,
  SuccessEnvelope,
  UpdateOrganizationBody,
} from "@repo/contracts";

import type { ApiClient } from "@/shared/api/client";

/**
 * `/api/v1/user/orgs` as plain typed functions (ADR-0034 §Entity API).
 *
 * **The tenant seen from inside it** (ADR-0067 §4). Everything here is either
 * self-scoped — `GET /orgs` is "the organizations I belong to", the switcher's
 * query — or addressed by an organization the caller is a member of, which the
 * API resolves with `requireMembership` and answers `404` for a stranger. The
 * client sends an id and never a slug: the slug is what a *customer's* URL
 * carries (§6), and translating one into the other is this app's job rather
 * than the API's.
 *
 * **There is no `get` by id, and the omission is the design.** The switcher
 * already holds every organization the caller belongs to, so a screen addressed
 * by slug resolves it out of that list — which is what makes an unknown slug a
 * not-found with no request at all rather than a `404` a round trip later.
 * Adding a detail endpoint here would be a second source of truth for one row.
 */
export const createOrganizationApi = (client: ApiClient) =>
  ({
    /**
     * `GET /user/orgs` — mine, each with my role in it.
     *
     * A bare array and no list language, which is the endpoint's own decision
     * rather than a shortcut here (`@repo/contracts`, ADR-0014 as carried by
     * ADR-0060): a user belongs to a handful of organizations, so there is
     * nothing to paginate and no allow-list for an index to serve.
     */
    listMine: async (): Promise<readonly OrganizationResource[]> => {
      const { data } =
        await client.instance.get<SuccessEnvelope<OrganizationResource[]>>(
          "/orgs",
        );

      return data.data;
    },

    /**
     * `POST /user/orgs` — a `team` organization with the caller as owner.
     *
     * `kind` is absent from the body by construction: exactly one `personal`
     * organization exists per account and the system creates it (ADR-0067 §2),
     * so there is no value of the field a customer could legally send.
     */
    create: async (
      body: CreateOrganizationBody,
    ): Promise<OrganizationResource> => {
      const { data } = await client.instance.post<
        SuccessEnvelope<OrganizationResource>
      >("/orgs", body);

      return data.data;
    },

    /**
     * `PATCH /user/orgs/:orgId` — name and slug, which are all an organization
     * has (ADR-0067 §7).
     *
     * A slug edit on a personal organization is refused by the service with
     * `409 ORGANIZATION_PERSONAL_UNDELETABLE`'s sibling code, not by this
     * function: the refusal is about the row's kind, and a client that filtered
     * it here would be re-implementing a rule it cannot see all of.
     */
    update: async (
      organizationId: string,
      body: UpdateOrganizationBody,
    ): Promise<OrganizationResource> => {
      const { data } = await client.instance.patch<
        SuccessEnvelope<OrganizationResource>
      >(`/orgs/${organizationId}`, body);

      return data.data;
    },

    /**
     * `DELETE /user/orgs/:orgId` — an owner, never an admin, and never a
     * personal organization (ADR-0067 §2). `204`.
     *
     * Soft on the server; from here it is simply gone, which is why the caller
     * navigates out of the organization it just removed rather than staying on
     * a screen addressed by a slug that no longer resolves.
     */
    remove: async (organizationId: string): Promise<void> => {
      await client.instance.delete(`/orgs/${organizationId}`);
    },
  }) as const;

export type OrganizationApi = ReturnType<typeof createOrganizationApi>;
