/**
 * Enumerations shared by the database, the API and its clients (ADR-0023).
 *
 * Each enum is declared **once**, as a readonly tuple, and the TypeScript union
 * is derived from it. That single declaration feeds three consumers:
 *
 * - `@repo/db` — `pgEnum('staff_role', STAFF_ROLES)` (ADR-0006);
 * - request validation — `z.enum(STAFF_ROLES)` (ADR-0011);
 * - clients — the union type, for exhaustive `switch` and typed UI state.
 *
 * Adding a value is therefore a migration (`ALTER TYPE … ADD VALUE`) plus an
 * edit here, and nothing else (ADR-0017).
 *
 * **Declaration order is load-bearing.** Postgres sorts an enum column by the
 * position of each label in its type, so `ORDER BY status` on a list endpoint
 * (ADR-0014) follows the order below, and `ALTER TYPE … ADD VALUE` appends
 * unless told otherwise. Reordering an array here is a schema change, not a
 * cosmetic edit: it silently changes what a sorted page returns.
 */

/**
 * The two populations (ADR-0017). They live in separate tables, authenticate
 * separately and are served by separate route segments (ADR-0015); the value
 * also discriminates the `sessions.principal_type` column (ADR-0018).
 */
export const POPULATIONS = ["staff", "user"] as const;
export type Population = (typeof POPULATIONS)[number];

/**
 * Staff roles (ADR-0017). Ordered most- to least-privileged for display only;
 * nothing in the code derives privilege from the position.
 */
export const STAFF_ROLES = [
  "super_admin",
  "admin",
  "manager",
  "editor",
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * The role that bypasses every staff role check (ADR-0019). Named so the bypass
 * is greppable from the guard, the seed (ADR-0008) and the "last super admin"
 * invariant in the staff service (ADR-0017).
 */
export const SUPER_ADMIN_ROLE = "super_admin" satisfies StaffRole;

/** User (customer) roles (ADR-0017). v1 has exactly one. */
export const USER_ROLES = ["customer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Any role of either population. `authorize()` is generic over the population
 * (ADR-0019) so this union is for storage and display, not for guards.
 */
export type Role = StaffRole | UserRole;

/**
 * Staff account status (ADR-0017). `invited` exists for the future invite flow;
 * v1 creates staff directly as `active` (ADR-0018 §Staff onboarding).
 */
export const STAFF_STATUSES = ["active", "invited", "disabled"] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

/**
 * User account status (ADR-0017). `pending_verification` exists for the future
 * email-verification flow; v1 self-registration starts users `active`.
 */
export const USER_STATUSES = [
  "active",
  "pending_verification",
  "disabled",
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Sort direction of a single `sort` entry (ADR-0014). */
export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/**
 * What an organization is (ADR-0067 §2). `personal` is the one every account
 * gets on the path that creates it and cannot delete on its own; `team` is
 * what a user creates through `POST /user/orgs`.
 *
 * `kind` never changes after insert: promoting a personal organization to a
 * team one is explicitly out of D15's scope, and the invariant "exactly one
 * personal organization per live user" is what the seeds and the backfill
 * assert.
 */
export const ORGANIZATION_KINDS = ["personal", "team"] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

/**
 * A membership's role inside one organization (ADR-0067 §2), ordered most- to
 * least-privileged for display only — nothing derives privilege from the
 * position, exactly as {@link STAFF_ROLES} does not.
 *
 * These are **not** {@link USER_ROLES}: a user role is a property of the
 * account across the whole system, a membership role is a property of one
 * (account, organization) pair. Sharing one type would tie two lifetimes that
 * have nothing to do with each other.
 *
 * `owner` is not invitable — ownership is granted by an owner to an existing
 * member (ADR-0067 §2) — which is a rule about invitations, not a second
 * enum: the invitations table carries a `role <> 'owner'` check and the
 * invitation schema narrows this tuple.
 */
export const ORGANIZATION_ROLES = ["owner", "admin", "member"] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

/**
 * The role an organization's membership must always have at least one of
 * (ADR-0067 §2). Named so the "last owner" invariant is greppable from the
 * service, the guard and the schema, the way {@link SUPER_ADMIN_ROLE} is.
 */
export const ORGANIZATION_OWNER_ROLE = "owner" satisfies OrganizationRole;

/**
 * What an invitation looks like from the outside (ADR-0067 §2).
 *
 * **Derived, not stored** — and deliberately not a `pgEnum`, unlike every
 * other tuple in this file. The row's facts are its timestamps (`expiresAt`,
 * `acceptedAt`, `declinedAt`, `revokedAt`), and `expired` is the one state no
 * column can hold: it becomes true as the clock passes `expires_at`, with no
 * row written and no sweeper to write one (D15 has none by decision). A stored
 * status would therefore say `pending` about an expired row, which is the
 * class of bug a second source of truth exists to create.
 *
 * The mapper folds the timestamps into one of these for the wire, and the
 * order is the lifecycle: `pending` first, then the three ways it ends, then
 * the one that just happens.
 */
export const INVITATION_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "revoked",
  "expired",
] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];
