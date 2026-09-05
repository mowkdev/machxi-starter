import type {
  CreateInvitationBody,
  CreateOrganizationBody,
  ListInvitationsQuery,
  ListMembershipsQuery,
  OrganizationResource,
  OrganizationRole,
  UpdateOrganizationBody,
} from "@repo/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useApiClient } from "@/shared/api/context";

import { createOrganizationApi } from "./organization.api";
import {
  createMyInvitationsApi,
  createOrganizationInvitationsApi,
} from "./organization.invitations.api";
import { invitationKeys, organizationKeys } from "./organization.keys";
import { createOrganizationMembersApi } from "./organization.members.api";

/**
 * The organization hooks (ADR-0034 as carried by ADR-0043).
 *
 * The invalidation rule every entity here follows — invalidate what this write
 * could have changed the response of — has one extra edge in this slice, and it
 * is the tenancy showing through: **almost every write changes the switcher's
 * list**. A rename changes the name it shows, a create adds a row to it, a
 * deletion and a leave remove one, and accepting an invitation adds one. So
 * `organizationKeys.mine()` is invalidated by all of them, and the ones that
 * also change a sub-list name that sub-list too.
 *
 * **Both read hooks carry `meta: { errorToast: true }`, which is not the
 * default** (ADR-0034 makes queries silent and lets them render their own
 * failure panel). These two have no panel to render into: a failed switcher
 * query looks exactly like an account with no organizations, and a failed
 * members query looks exactly like an organization with nobody in it — a
 * silent failure manufactured by the client, which is the shape `D15.4`'s
 * review found on the admin's copy of the same table. The surfaces branch on
 * `isError` as well; the toast is what tells someone why.
 */

const useApi = () => createOrganizationApi(useApiClient());
const useMembersApi = () => createOrganizationMembersApi(useApiClient());
const useInvitationsApi = () =>
  createOrganizationInvitationsApi(useApiClient());
const useMyInvitationsApi = () => createMyInvitationsApi(useApiClient());

/**
 * `errorToast: false` on the two writes submitted from a form that renders its
 * own failures inline (ADR-0034): a toast repeating what is already under the
 * field is duplication rather than an extra courtesy.
 */
const FORM_MUTATION_META = { errorToast: false } as const;

/** The switcher's query, and the source every slug on this app resolves against. */
export const useMyOrganizations = () => {
  const api = useApi();

  return useQuery({
    queryKey: organizationKeys.mine(),
    queryFn: () => api.listMine(),
    meta: { errorToast: true },
  });
};

/**
 * One organization, by the slug in the URL (ADR-0067 §6).
 *
 * **It makes no request of its own**, which is the whole point: the list above
 * is already in the cache because the switcher renders on every screen, so a
 * slug outside the caller's memberships is a not-found the client can answer
 * without asking — the URL rule of ADR-0067 §4 read from the browser.
 *
 * `found` is deliberately three-valued rather than a nullable organization: a
 * caller has to be able to tell "no such membership" from "the list has not
 * arrived yet", because only the first of those is a not-found and rendering
 * one for the second would flash a dead end on every cold load.
 */
export const useMyOrganizationBySlug = (slug: string) => {
  const query = useMyOrganizations();
  const organization = query.data?.find((row) => row.slug === slug);

  return {
    organization,
    /** The list is still arriving; nothing can be concluded from its absence. */
    isPending: query.isPending,
    isError: query.isError,
    /**
     * The list arrived, is not being replaced, and holds no such slug — a
     * not-found, decided here.
     *
     * **`!isFetching` is load-bearing and was a review finding.** During a
     * background refetch React Query keeps `status: "success"` with the *old*
     * rows, and every write in this slice invalidates this list and then
     * navigates: creating an organization and renaming an address both land on
     * a slug the cached list has never seen, so without this clause the screen
     * a customer reaches after "The organization was created." is a not-found
     * that clears a moment later.
     */
    isMissing:
      query.isSuccess && !query.isFetching && organization === undefined,
  } as const;
};

export const useCreateOrganization = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateOrganizationBody) => api.create(body),
    meta: { ...FORM_MUTATION_META, success: "organizations:outcomes.created" },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: organizationKeys.mine() });
    },
  });
};

export const useUpdateOrganization = (organizationId: string) => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateOrganizationBody) =>
      api.update(organizationId, body),
    meta: { ...FORM_MUTATION_META, success: "organizations:outcomes.updated" },
    onSuccess: () => {
      // The name and the slug are both on the switcher's rows, and the slug is
      // the address this screen is on — so the list is what has to be right
      // before anything navigates.
      void queryClient.invalidateQueries({ queryKey: organizationKeys.mine() });
    },
  });
};

export const useDeleteOrganization = (organizationId: string) => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.remove(organizationId),
    meta: { success: "organizations:outcomes.deleted" },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: organizationKeys.mine() });
      /*
       * Removed rather than invalidated: the organization is gone, so
       * refetching its members would be a `404` and a toast about it on the way
       * out. The same reasoning `useDeleteProfile` gives for the profile's own
       * key.
       */
      queryClient.removeQueries({
        queryKey: organizationKeys.detail(organizationId),
      });
    },
  });
};

export const useOrganizationMembers = (
  organizationId: string,
  params: ListMembershipsQuery,
) => {
  const api = useMembersApi();

  return useQuery({
    queryKey: organizationKeys.members(organizationId, params),
    queryFn: () => api.list(organizationId, params),
    meta: { errorToast: true },
  });
};

export const useSetOrganizationMemberRole = (organizationId: string) => {
  const api = useMembersApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      userId,
      role,
    }: {
      userId: string;
      role: OrganizationRole;
    }) => api.setRole(organizationId, userId, role),
    meta: { success: "organizations:outcomes.roleChanged" },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: organizationKeys.memberLists(organizationId),
      });
      /*
       * The caller's own role is a field of the switcher's row, and granting
       * `owner` to somebody else is how ownership *moves* (ADR-0067 §2) — so
       * this write can change what the person doing it is allowed to see.
       */
      void queryClient.invalidateQueries({ queryKey: organizationKeys.mine() });
    },
  });
};

/**
 * Removing a member — and **leaving**, which is the same write (ADR-0067 §2).
 *
 * The caller decides which of the two it is by whose id it passes, and the API
 * decides whether they were allowed to: `owner` or `admin` to remove somebody
 * else, anybody for themselves. What this hook cannot know is which happened,
 * so it invalidates the switcher's list either way — a leave removes a row from
 * it, and a removal does not.
 */
export const useRemoveOrganizationMember = (organizationId: string) => {
  const api = useMembersApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => api.remove(organizationId, userId),
    meta: { success: "organizations:outcomes.memberRemoved" },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: organizationKeys.memberLists(organizationId),
      });
      void queryClient.invalidateQueries({ queryKey: organizationKeys.mine() });
    },
  });
};

/**
 * Leaving — the same write as the one above, asked as a different question.
 *
 * The API keeps removal and departure one endpoint with one invariant, because
 * the row that goes is the same row and the last owner may do neither
 * (ADR-0067 §2). What differs is the *interaction*: a person removing somebody
 * else stays where they are, and a person leaving loses the screen they are
 * standing on. A second hook is how the client says which one it asked for —
 * its own sentence on success, and a caller that navigates.
 *
 * The id it removes is the caller's own, passed at `mutate` by a call site
 * that has a principal — the only account this is ever asked to remove.
 */
export const useLeaveOrganization = (organizationId: string) => {
  const api = useMembersApi();
  const queryClient = useQueryClient();

  return useMutation({
    /*
     * The caller's own id arrives at `mutate` rather than at the hook, so there
     * is no id to hold while there is no principal — the review's finding, and
     * the difference between a guarded call site and an empty path segment one
     * refactor away.
     */
    mutationFn: (userId: string) => api.remove(organizationId, userId),
    meta: { success: "organizations:outcomes.left" },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: organizationKeys.mine() });
      // The members list of an organization the caller is no longer in would
      // answer `404`; removed rather than invalidated, as the deletion is.
      queryClient.removeQueries({
        queryKey: organizationKeys.detail(organizationId),
      });
    },
  });
};

export const useOrganizationInvitations = (
  organizationId: string,
  params: ListInvitationsQuery,
) => {
  const api = useInvitationsApi();

  return useQuery({
    queryKey: organizationKeys.invitations(organizationId, params),
    queryFn: () => api.list(organizationId, params),
    meta: { errorToast: true },
  });
};

export const useInviteToOrganization = (organizationId: string) => {
  const api = useInvitationsApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateInvitationBody) =>
      api.create(organizationId, body),
    meta: { ...FORM_MUTATION_META, success: "organizations:outcomes.invited" },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: organizationKeys.invitationLists(organizationId),
      });
    },
  });
};

export const useRevokeInvitation = (organizationId: string) => {
  const api = useInvitationsApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.revoke(organizationId, id),
    meta: { success: "organizations:outcomes.invitationRevoked" },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: organizationKeys.invitationLists(organizationId),
      });
    },
  });
};

/** `GET /user/invitations` — what has been offered to my address. */
export const useMyInvitations = () => {
  const api = useMyInvitationsApi();

  return useQuery({
    queryKey: invitationKeys.mine(),
    queryFn: () => api.list(),
    meta: { errorToast: true },
  });
};

/**
 * Accepting, which is the one write in this slice that changes two lists it can
 * name and a third it cannot.
 *
 * The offer leaves the received list and the organization joins the switcher's,
 * and both are invalidated here rather than by the section that called it —
 * they are both this entity's keys, which is where ADR-0043 puts the
 * responsibility. What it deliberately does not do is navigate into the
 * organization it just returned: where a customer goes next is routing, and an
 * entity hook may not decide it.
 */
export const useAcceptInvitation = () => {
  const api = useMyInvitationsApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string): Promise<OrganizationResource> => api.accept(id),
    meta: { success: "organizations:outcomes.invitationAccepted" },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invitationKeys.mine() });
      void queryClient.invalidateQueries({ queryKey: organizationKeys.mine() });
    },
  });
};

export const useDeclineInvitation = () => {
  const api = useMyInvitationsApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.decline(id),
    meta: { success: "organizations:outcomes.invitationDeclined" },
    onSuccess: () => {
      // Declining ends an offer and creates no membership, so the switcher's
      // list is untouched and is deliberately not invalidated.
      void queryClient.invalidateQueries({ queryKey: invitationKeys.mine() });
    },
  });
};
