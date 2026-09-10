import type {
  InvitationLookupResource,
  InvitationResource,
  InvitationStatus,
  MembershipResource,
  OrganizationResource,
  OrganizationRole,
} from "@repo/contracts";

import type { InvitationWithOrganization } from "./invitations.repository.js";
import type { MemberRecord } from "./memberships.repository.js";
import type { OrganizationRecord } from "./organizations.repository.js";

/**
 * Storage rows → wire resources (ADR-0012).
 *
 * One set of mappers for all three mounts, so a client learns one shape per
 * thing however it reached it. What differs between the segments is what the
 * caller may *know*, and that is expressed as an argument rather than as a
 * second mapper: `toOrganizationResource` takes the caller's role, which the
 * user segment has from `requireMembership` and the admin segment does not
 * have at all, staff being above tenants rather than inside them (ADR-0067 §3).
 *
 * `token_hash` has no field on any resource here, and no record reaching these
 * functions carries one — the repository does not select it. The rule
 * `password_hash` and `refresh_token_hash` follow, made structural.
 */

export const toOrganizationResource = (
  record: OrganizationRecord,
  /** The caller's role here, or `null` when they are not a member. */
  role: OrganizationRole | null,
): OrganizationResource => ({
  id: record.id,
  slug: record.slug,
  name: record.name,
  kind: record.kind,
  role,
  createdBy: record.createdBy,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
  deletedAt: record.deletedAt?.toISOString() ?? null,
});

export const toMembershipResource = (
  record: MemberRecord,
): MembershipResource => ({
  organizationId: record.organizationId,
  userId: record.userId,
  email: record.email,
  firstName: record.firstName,
  lastName: record.lastName,
  role: record.role,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
});

/**
 * The invitation's state, folded out of its four timestamps (ADR-0067 §2, as
 * amended at `D15.1`).
 *
 * There is no `status` column to read, and that is the decision rather than an
 * omission: `expired` becomes true as a clock passes, with no row written and
 * no sweeper to write one, so a stored status would say `pending` about an
 * expired row. Deriving it here means the wire is computed from the facts and
 * cannot disagree with them.
 *
 * The three terminal stamps are mutually exclusive — the atomic consume checks
 * all of them before writing any — so the order they are tested in decides
 * nothing. `expired` is tested last because it is the only one that is a
 * comparison rather than a fact.
 */
export const toInvitationStatus = (
  record: {
    readonly acceptedAt: Date | null;
    readonly declinedAt: Date | null;
    readonly revokedAt: Date | null;
    readonly expiresAt: Date;
  },
  at: Date,
): InvitationStatus => {
  if (record.acceptedAt !== null) return "accepted";
  if (record.declinedAt !== null) return "declined";
  if (record.revokedAt !== null) return "revoked";

  return record.expiresAt.getTime() <= at.getTime() ? "expired" : "pending";
};

export const toInvitationResource = (
  record: InvitationWithOrganization,
  at: Date,
): InvitationResource => ({
  id: record.id,
  organizationId: record.organizationId,
  organizationName: record.organizationName,
  email: record.email,
  role: record.role,
  status: toInvitationStatus(record, at),
  expiresAt: record.expiresAt.toISOString(),
  createdAt: record.createdAt.toISOString(),
});

/**
 * The three fields the holder of a link is shown (ADR-0071 §5).
 *
 * A mapper of its own rather than a narrowed {@link toInvitationResource},
 * because what it drops is the point: no `id`, so an unauthenticated caller is
 * never handed the identifier the *other* accept path takes (ADR-0067 §5), and
 * no `status`, because a lookup answers only for a pending invitation and
 * every other state is one `404`. A `Pick<>` of the full resource would keep
 * both fields one careless edit away.
 */
export const toInvitationLookupResource = (
  record: InvitationWithOrganization,
): InvitationLookupResource => ({
  organizationName: record.organizationName,
  email: record.email,
  role: record.role,
});
