import type { ListUsersQuery } from "@repo/contracts";

/**
 * The one place a user query key is built (ADR-0034 §Query keys).
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
export const userKeys = {
  all: ["users"] as const,
  lists: () => [...userKeys.all, "list"] as const,
  list: (params: ListUsersQuery) => [...userKeys.lists(), params] as const,
  details: () => [...userKeys.all, "detail"] as const,
  detail: (id: string) => [...userKeys.details(), id] as const,
} as const;
