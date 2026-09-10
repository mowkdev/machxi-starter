import type {
  InvitationStatus,
  OrganizationKind,
  OrganizationRole,
} from "../enums.js";
import type { IsoDateTime } from "../primitives.js";

/**
 * An organization as the API returns it (ADR-0067 §2).
 *
 * One shape on both segments — `/api/v1/admin/organizations` and
 * `/api/v1/user/orgs` — so a client learns it once (ADR-0012), and the same
 * reasoning `UserResource` follows: `deletedAt` is on the wire because the
 * admin endpoints return soft-deleted rows on purpose and nothing else in the
 * resource would tell a reader.
 *
 * `role` is the one field that is not a column. It is the **caller's** role in
 * this organization, present on the user segment where a membership is what
 * got the caller here, and `null` on the admin segment, where staff are never
 * members (ADR-0067 §3). A separate resource for the two segments was the
 * alternative and was rejected for the reason 0012 gives: two shapes for one
 * thing is two things for a client to learn, and the field's nullability says
 * exactly what its absence would.
 */
export interface OrganizationResource {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly kind: OrganizationKind;
  /**
   * The caller's role here, or `null` when the caller is not a member — which
   * on the admin segment is always, staff being above tenants rather than
   * inside them (ADR-0067 §3).
   */
  readonly role: OrganizationRole | null;
  readonly createdBy: string;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  /** When it was soft-deleted; `null` for a live one (ADR-0067 §3). */
  readonly deletedAt: IsoDateTime | null;
}

/**
 * A membership as the API returns it (ADR-0067 §2).
 *
 * The pair *is* the identity — there is no `id` on the row and none here. It
 * carries the member's address and name so a members list is renderable
 * without an `N+1` of user lookups; that is not an enumeration surface,
 * because every reader of it is already a member of the organization the
 * membership belongs to and could see the same people in any other way.
 */
export interface MembershipResource {
  readonly organizationId: string;
  readonly userId: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly role: OrganizationRole;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/**
 * An invitation as the API returns it (ADR-0067 §2).
 *
 * **`token_hash` has no field here, and that is the whole point**: the column
 * is a credential digest, it is dropped the way `passwordHash` and
 * `refreshTokenHash` are, and the repository does not even select it — so
 * there is no value for this mapper to forget.
 *
 * `status` is **derived** from the four timestamps rather than read from a
 * column (ADR-0067 §2, amended): `expired` becomes true as a clock passes,
 * with no row written and no sweeper to write one, so a stored status would
 * say `pending` about an expired row.
 */
export interface InvitationResource {
  readonly id: string;
  readonly organizationId: string;
  /**
   * The organization's name, so the invitee's own list renders without a
   * second request. Absent from no invitation: the pending lists join a live
   * organization, and an invitation into a deleted one is not pending.
   */
  readonly organizationName: string;
  readonly email: string;
  readonly role: OrganizationRole;
  readonly status: InvitationStatus;
  readonly expiresAt: IsoDateTime;
  readonly createdAt: IsoDateTime;
}

/**
 * What the holder of an invitation link is told before they act on it
 * (ADR-0071 §5, on ADR-0067 §5's two conditions).
 *
 * Three fields and no `id`, deliberately. This is the answer to an
 * **unauthenticated** request whose whole authority is the token: the screen
 * needs the organization's name to say what is being offered, the invited
 * address to prefill a locked register form and to tell a signed-in visitor
 * whether it is theirs, and the role so the offer is not a surprise. An `id`
 * would be an identifier the caller could take to the *other* accept path —
 * the one scoped by address alone (ADR-0067 §5) — which is exactly the
 * authority holding the token does not carry.
 *
 * There is no `status` either: a lookup answers only for an invitation that is
 * still pending, and every other state is the same `404`.
 */
export interface InvitationLookupResource {
  readonly organizationName: string;
  readonly email: string;
  readonly role: OrganizationRole;
}
