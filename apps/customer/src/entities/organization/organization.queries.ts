import { useEffect } from "react";

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
import { useParams, useRouterState } from "@tanstack/react-router";

import { useApiClient, useSession } from "@/shared/api/context";

import {
  readRememberedSlug,
  resolveActiveOrganization,
  resolveRememberedSlug,
  writeRememberedSlug,
  type ActiveOrganization,
} from "./active-organization";
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
 * Which organization the caller is acting as (`D15.9`, ADR-0067 §6 as amended
 * 2026-09-07) — the resolver bound to the router and to the query above.
 *
 * Every decision it makes is `resolveActiveOrganization`'s; this is the two
 * lines that hand it the URL's slug and the list's rows. Every tenant page, the
 * switcher and the sidebar's links read this and nothing else, which is what
 * makes "which organization am I in" a question with one answer.
 *
 * `strict: false` because this reads on every screen and only some of them are
 * addressed by an organization. It is the router's own answer to "where am I",
 * which is the only truthful one — a component tracking the active organization
 * in state would have to be told about every navigation, and two tabs would
 * disagree.
 */
export const useActiveOrganization = (): ActiveOrganization & {
  readonly isError: boolean;
} => {
  const query = useMyOrganizations();
  const { orgSlug } = useParams({ strict: false });

  const resolved = resolveActiveOrganization(
    query.isSuccess ? query.data : undefined,
    orgSlug,
  );

  /*
   * **`isFetching` narrows the not-found and nothing else**, which is a review
   * finding and the second time this clause has been got wrong in one
   * deliverable.
   *
   * The property it has to keep is `D15.5`'s: during a background refetch React
   * Query holds `status: "success"` with the *old* rows, and every write in this
   * slice invalidates this list and then navigates — so creating a team or
   * changing its address lands on a slug the cached list has never seen, and a
   * resolver that trusted those rows would answer "missing" on the screen a
   * customer reaches immediately after "The organization was updated."
   *
   * The first version bought that by treating **any** refetch as pending, which
   * is far too wide: `mine()` is invalidated by every membership write, and
   * `refetchOnWindowFocus` is on with a 30-second `staleTime` — so changing a
   * member's role, or simply tabbing away and back, unmounted whatever tenant
   * screen was open into skeletons and made the switcher read "Private" while it
   * did. Every suite passed anyway, because every assertion sits inside a
   * `waitFor`.
   *
   * So a resolution that already *found* something is returned as it stands, and
   * only the answer that would be a dead end waits for the refetch to settle.
   */
  if (resolved.state === "missing" && query.isFetching)
    return {
      organization: undefined,
      state: "pending",
      slug: orgSlug,
      isError: query.isError,
    };

  return { ...resolved, isError: query.isError };
};

/**
 * Whether the caller is standing on a **self-scoped** screen (ADR-0067 §6).
 *
 * `/account/*` belongs to the person rather than to a tenant, which is what
 * makes it the one place the shell shows a context the URL does not carry.
 */
const useSelfScoped = (): boolean =>
  useRouterState({
    /*
     * A **segment** match rather than a prefix one, on the security pass's note:
     * `startsWith("/account")` also claims a future `/accounts`, and the switcher
     * would quietly stop remembering context on it. Cheap to get right now and
     * invisible to find later.
     */
    select: (state) =>
      state.location.pathname === "/account" ||
      state.location.pathname.startsWith("/account/"),
  });

/**
 * **What the shell shows** — the context the switcher names and the drawer's
 * links point into (`D15.9`, ADR-0067 §6 as amended 2026-09-07).
 *
 * On a tenant screen this is `useActiveOrganization`'s answer, unchanged: the
 * URL is the context. On a self-scoped screen it is the **remembered** team,
 * filtered through the memberships — the second of the remembered key's exactly
 * two consumers, and the reason opening one's profile from a team does not eject
 * the customer into the private context on the way back.
 *
 * **It lives here rather than in the switcher, which was a review finding.** The
 * record names two shell consumers — "the shell's switcher **and links**" — and
 * the first version had this hook private to the widget, so `AppSidebar` read
 * the URL's slug directly and its Home link sent a customer standing in Acme's
 * profile to `/`. That is precisely the eject the amendment exists to prevent,
 * arriving through the other half of the same sentence.
 */
export const useDisplayedOrganization = (): {
  readonly organization: OrganizationResource | undefined;
  readonly slug: string | undefined;
} => {
  const active = useActiveOrganization();
  const query = useMyOrganizations();
  const principalId = usePrincipalId();
  const selfScoped = useSelfScoped();

  if (!selfScoped)
    return { organization: active.organization, slug: active.slug };

  const remembered =
    principalId === null
      ? undefined
      : resolveRememberedSlug(query.data, readRememberedSlug(principalId));

  return {
    organization: query.data?.find((row) => row.slug === remembered),
    slug: remembered,
  };
};

/**
 * Remember the context the caller is standing in, per device and per principal.
 *
 * **Written from the URL rather than from a click**, which is what makes it true
 * after a reload, a pasted link or a browser back: the URL *is* the context
 * (ADR-0067 §4), so what is worth remembering is where the customer ended up.
 *
 * **Only a `resolved` context is written, and that was a review finding.** The
 * first version stored `slug` whatever the resolution said, so opening a
 * colleague's link to a tenant you are not in — a not-found on screen — quietly
 * overwrote the team you actually work in, and every later sign-in landed on the
 * private home. The read side filters the junk value, so the loss was silent.
 *
 * `null` on the private context, so "never chose" and "chose private" stay one
 * state. Nothing is written from a self-scoped screen: `/account/profile` carries
 * no slug, and clearing there would erase the very value it is reading back.
 */
export const useRememberOrganization = (): void => {
  const { slug, state } = useActiveOrganization();
  const principalId = usePrincipalId();
  const selfScoped = useSelfScoped();

  useEffect(() => {
    if (principalId === null || selfScoped || state !== "resolved") return;

    writeRememberedSlug(principalId, slug ?? null);
  }, [principalId, selfScoped, slug, state]);
};

/**
 * The principal's id, for the two consumers that need a device key.
 *
 * `null` while no session is hydrated, which a caller must handle rather than
 * default: writing somebody's last tenant under a made-up key would be a
 * preference nobody can ever read back.
 */
export const usePrincipalId = (): string | null => {
  const { principal } = useSession();

  return principal?.id ?? null;
};

/**
 * Where sign-in lands (`D15.9`, ADR-0067 §6 as amended 2026-09-07).
 *
 * The **first** of the remembered key's exactly two consumers — the other is
 * what the shell's switcher names on a self-scoped screen. A tenant screen never
 * reads it: its context is its URL, which is the rule of §4 unchanged.
 *
 * **It fetches only when something is remembered**, which is what keeps the
 * common path free: an account that has never been in a team pays nothing, and
 * one that has pays a request the shell was about to make anyway — `fetchQuery`
 * on the switcher's own key, so what it costs is a cache seed rather than a
 * second copy of the list.
 *
 * **The membership check is the point.** A customer removed from a team, or one
 * whose team was deleted, would otherwise sign in onto a not-found forever: the
 * thing sending them there is on their own device and no server response can
 * clear it. So the remembered slug is resolved against the list and falls back
 * to the private context silently.
 *
 * It returns a slug rather than navigating, because deciding where to go is the
 * *feature*'s (ADR-0049) — this layer may not know the route tree.
 */
export const useLandingSlug = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return async (principalId: string): Promise<string | undefined> => {
    const remembered = readRememberedSlug(principalId);

    if (remembered === undefined) return undefined;

    const rows = await queryClient.fetchQuery({
      queryKey: organizationKeys.mine(),
      queryFn: () => api.listMine(),
      /*
       * **Defence in depth, on the security pass's note.** This runs in the
       * continuation of `client.login`, before React has committed the principal
       * change and therefore before `PrincipalCacheBoundary` clears the cache —
       * so with the default 30-second `staleTime` it could in principle decide
       * where a freshly authenticated principal lands from a list somebody else
       * fetched. No reachable path was found (sign-out and `onSessionEnded` both
       * clear it, and `_auth` bounces an authenticated caller off `/login`), and
       * the answer is filtered against the memberships anyway — but the landing
       * of a new session should read the wire, and saying so costs one line.
       */
      staleTime: 0,
    });

    return resolveRememberedSlug(rows, remembered);
  };
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

/**
 * Accepting from the mailed link (`D18.8`, ADR-0071 §5).
 *
 * **`useAcceptInvitation`'s twin, and it invalidates exactly the same two
 * lists** — the offer leaves the received list and the organization joins the
 * switcher's — because the write is the same write asked with a different
 * authority. What differs is only what names the invitation: a token out of a
 * URL fragment rather than an id out of the caller's own list.
 *
 * **Neither `meta.success` nor a failure toast, and both omissions are
 * deliberate.** The inbox stays where it is and needs a sentence to say
 * something happened; this screen's whole answer is the navigation into the
 * organization it just joined, and a toast arriving on top of a page that has
 * already changed underneath the reader is the surface saying the same thing
 * twice. Failures are `FORM_MUTATION_META`'s case exactly (`D18.8`,
 * `code-reviewer`): the screen renders every one of them itself — the dead
 * link as a state of its own, everything else inline through ADR-0034's code
 * map — so the global handler's toast would be the identical sentence a second
 * time.
 *
 * It deliberately does not navigate: where a customer goes next is routing,
 * and an entity hook may not decide it (`useAcceptInvitation`'s own rule).
 */
export const useAcceptInvitationByToken = () => {
  const api = useMyInvitationsApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (token: string): Promise<OrganizationResource> =>
      api.acceptByToken(token),
    meta: FORM_MUTATION_META,
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
