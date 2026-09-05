import type {
  ListMembershipsQuery,
  ListOrganizationsQuery,
} from "@repo/contracts";

/**
 * The one place a organization query key is built (ADR-0034 §Query keys).
 *
 * **No inline key arrays at call sites, ever** — a key written twice is an
 * invalidation that misses, and the miss is silent: the screen shows stale data
 * until something else happens to refetch it.
 *
 * Keys are hierarchical data rather than strings, so invalidation targets a
 * prefix: `lists()` hits every page, sort and filter permutation without naming
 * any of them. The params object inside `list()` is the *parsed* query, and
 * TanStack Query hashes keys structurally, so two objects meaning the same
 * request are the same cache entry regardless of property order.
 */
export const organizationsKeys = {
  all: ["organizations"] as const,
  lists: () => [...organizationsKeys.all, "list"] as const,
  list: (params: ListOrganizationsQuery) =>
    [...organizationsKeys.lists(), params] as const,
  details: () => [...organizationsKeys.all, "detail"] as const,
  detail: (id: string) => [...organizationsKeys.details(), id] as const,
  /*
   * The memberships sub-resource, keyed **under the organization** rather than
   * beside it (ADR-0067 §3): a membership belongs to one tenant and to no
   * other, so `memberLists(id)` is the prefix a write invalidates and it can
   * never reach another organization's page.
   */
  memberLists: (organizationId: string) =>
    [...organizationsKeys.detail(organizationId), "members"] as const,
  members: (organizationId: string, params: ListMembershipsQuery) =>
    [...organizationsKeys.memberLists(organizationId), params] as const,
} as const;
