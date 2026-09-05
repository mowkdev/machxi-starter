import type {
  ListInvitationsQuery,
  ListMembershipsQuery,
} from "@repo/contracts";

/**
 * The one place an organization query key is built (ADR-0034 §Query keys,
 * ADR-0043 §Invalidation).
 *
 * **No inline key arrays at call sites, ever** — a key written twice is an
 * invalidation that misses, and the miss is silent.
 *
 * Keys are hierarchical data rather than strings, so invalidation targets a
 * prefix. The members and invitations of an organization hang **under** its
 * detail entry rather than beside it, the admin's arrangement and for its
 * reason: they belong to one tenant and to no other, so a write can never
 * invalidate another organization's page by accident.
 *
 * `mine()` is the switcher's — `GET /user/orgs`, scoped by the principal rather
 * than by a tenant (ADR-0067 §5). It is a sibling of `details()` and not a
 * parent: every screen in this app resolves its organization out of that one
 * list, so an organization write invalidates `mine()` explicitly and not by
 * standing above it.
 */
export const organizationKeys = {
  all: ["organizations"] as const,
  /** The switcher's list: the organizations the caller belongs to. */
  mine: () => [...organizationKeys.all, "mine"] as const,
  details: () => [...organizationKeys.all, "detail"] as const,
  detail: (organizationId: string) =>
    [...organizationKeys.details(), organizationId] as const,
  memberLists: (organizationId: string) =>
    [...organizationKeys.detail(organizationId), "members"] as const,
  members: (organizationId: string, params: ListMembershipsQuery) =>
    [...organizationKeys.memberLists(organizationId), params] as const,
  invitationLists: (organizationId: string) =>
    [...organizationKeys.detail(organizationId), "invitations"] as const,
  invitations: (organizationId: string, params: ListInvitationsQuery) =>
    [...organizationKeys.invitationLists(organizationId), params] as const,
} as const;

/**
 * The caller's **received** invitations, keyed apart from the organizations
 * (ADR-0067 §4).
 *
 * A separate root rather than a branch of `organizationKeys`, because the two
 * lists are scoped by different things: one is "the organizations I am in", the
 * other is "the invitations sent to my address", and a received invitation
 * belongs to an organization the caller is by definition not a member of yet.
 * Nesting it would put a key under a prefix whose invalidation has no business
 * refetching it.
 *
 * Accepting one changes both, which is a cross-list invalidation the entity
 * layer owns here because both lists are this slice's (`organization.queries`).
 */
export const invitationKeys = {
  all: ["invitations"] as const,
  /** `GET /user/invitations` — addressed to me, still pending. */
  mine: () => [...invitationKeys.all, "mine"] as const,
} as const;
