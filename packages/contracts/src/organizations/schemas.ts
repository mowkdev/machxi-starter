import { z } from "zod";

import {
  ORGANIZATION_KINDS,
  ORGANIZATION_OWNER_ROLE,
  ORGANIZATION_ROLES,
  type OrganizationRole,
} from "../enums.js";
import { listQuerySchema, type FilterSpec } from "../list-query.js";
import { customRule } from "../locales/source.js";
import { emailSchema, idSchema, slugSchema } from "../primitives.js";

/**
 * Request schemas for the organizations module (ADR-0023).
 *
 * One module, three mounts (ADR-0067 §3, §4): `/api/v1/user/orgs` where the
 * caller is a member, `/api/v1/user/invitations` where the caller is an
 * invitee, and `/api/v1/admin/organizations` where the caller is staff.
 *
 * The `:orgId` parameter is validated **twice** and neither is redundant:
 * `requireMembership` parses it at the mount, above every route, because it
 * has to read the database with it and a malformed id must be the same `404`
 * a stranger's organization is; the route schemas below parse it again so a
 * handler reads `req.valid.params` and never `req.params` (ADR-0009).
 */

/** The organization in the path — `/user/orgs/:orgId/...`. */
export const orgIdParams = z.strictObject({ orgId: idSchema });
export type OrgIdParams = z.infer<typeof orgIdParams>;

/** A membership addressed within an organization: the pair, as a path. */
export const membershipParams = z.strictObject({
  orgId: idSchema,
  userId: idSchema,
});
export type MembershipParams = z.infer<typeof membershipParams>;

/**
 * A membership addressed on the **admin** segment.
 *
 * The same pair as {@link membershipParams} with the organization named `id`
 * rather than `orgId`, because there it is the resource's own identifier —
 * `/admin/organizations/:id/memberships/:userId` — and here it is a prefix the
 * caller is a member of. Two names for one shape is the honest consequence of
 * two URL layouts; sharing the schema and renaming the field would make one of
 * the two URLs lie about what its parameter is.
 */
export const organizationMembershipParams = z.strictObject({
  id: idSchema,
  userId: idSchema,
});
export type OrganizationMembershipParams = z.infer<
  typeof organizationMembershipParams
>;

/** One invitation of one organization. */
export const orgInvitationParams = z.strictObject({
  orgId: idSchema,
  id: idSchema,
});
export type OrgInvitationParams = z.infer<typeof orgInvitationParams>;

/** One invitation addressed to the caller — no organization in the path. */
export const invitationIdParams = z.strictObject({ id: idSchema });
export type InvitationIdParams = z.infer<typeof invitationIdParams>;

/** `:id` of any single-organization admin route. */
export const organizationIdParams = z.strictObject({ id: idSchema });
export type OrganizationIdParams = z.infer<typeof organizationIdParams>;

/** An organization's own editable fields — the whole of them (ADR-0067 §7). */
export const organizationNameSchema = z.string().trim().min(1).max(120);

/**
 * `POST /api/v1/user/orgs` — any user creates a `team` organization and is its
 * owner (ADR-0067 §2).
 *
 * `kind` is absent by construction rather than optional-and-refused: a user
 * cannot create a second `personal` organization, because exactly one exists
 * per account and the system creates it. Accepting the field only to reject
 * one of its two values would be a rule a reader has to find in a service.
 */
export const createOrganizationBody = z.strictObject({
  name: organizationNameSchema,
  slug: slugSchema,
});
export type CreateOrganizationBody = z.infer<typeof createOrganizationBody>;

/**
 * `PATCH /api/v1/user/orgs/:orgId` and `PATCH /api/v1/admin/organizations/:id`
 * — name and slug, and nothing else (ADR-0067 §7).
 *
 * `kind` never changes after insert and `createdBy` is history, so neither is
 * here. A slug edit on a `personal` organization is refused by the service
 * with `409`, not by this schema: the schema cannot see which row is being
 * edited, and the refusal is about the organization's kind rather than about
 * the request's shape.
 */
export const updateOrganizationBody = z
  .strictObject({
    name: organizationNameSchema.optional(),
    slug: slugSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, customRule("updateNotEmpty"));
export type UpdateOrganizationBody = z.infer<typeof updateOrganizationBody>;

/**
 * `POST /api/v1/admin/organizations` — staff create one directly.
 *
 * It takes `kind` and an owner, which the user-segment create cannot: staff
 * are never members (ADR-0067 §3), so somebody has to be named as the owner of
 * an organization staff bring into existence, and `personal` is refused by the
 * service because exactly one exists per account and the system creates it.
 */
export const createOrganizationAdminBody = z.strictObject({
  name: organizationNameSchema,
  slug: slugSchema,
  /** The account that will own it — staff cannot own an organization. */
  ownerId: idSchema,
});
export type CreateOrganizationAdminBody = z.infer<
  typeof createOrganizationAdminBody
>;

/**
 * A membership role in a request body.
 *
 * `owner` is included: granting ownership to an existing member is how
 * ownership moves (ADR-0067 §2). The *invitation* body narrows it below.
 */
export const membershipRoleBody = z.strictObject({
  role: z.enum(ORGANIZATION_ROLES),
});
export type MembershipRoleBody = z.infer<typeof membershipRoleBody>;

/** `POST /api/v1/admin/organizations/:id/memberships` — by user id (ADR-0067 §3). */
export const addMembershipBody = z.strictObject({
  userId: idSchema,
  role: z.enum(ORGANIZATION_ROLES),
});
export type AddMembershipBody = z.infer<typeof addMembershipBody>;

/**
 * The roles an invitation may name (ADR-0067 §2).
 *
 * The shared tuple narrowed rather than a second enum: `owner` is not
 * invitable because ownership is granted by an owner to an existing member,
 * and that is one rule — said here, and said in the database as
 * `organization_invitations_role_not_owner`.
 */
export const INVITABLE_ROLES = [
  "admin",
  "member",
] as const satisfies readonly Exclude<
  OrganizationRole,
  typeof ORGANIZATION_OWNER_ROLE
>[];

/**
 * `POST /api/v1/user/orgs/:orgId/invitations` — an invitation by **address**
 * (ADR-0067 §2, ADR-0020 §Enumeration).
 *
 * It names an address and never an account, which is what makes the flow
 * enumeration-safe by construction: creating one looks no user up, so it
 * cannot answer differently for an address that has an account.
 */
export const createInvitationBody = z.strictObject({
  email: emailSchema,
  role: z.enum(INVITABLE_ROLES),
});
export type CreateInvitationBody = z.infer<typeof createInvitationBody>;

/* ── list queries (ADR-0014 as carried by ADR-0060) ───────────────────────── */

/**
 * The sortable allow-list, named so the module's index test can read it
 * (ADR-0060 §3) — the `LIST_USERS_SORTABLE` arrangement, and for its reason:
 * `listQuerySchema` swallows its options into a parser, and the rule "a column
 * enters an allow-list only with its index in the same step" needs the list
 * back out to be checked against the schema's index declarations.
 */
export const LIST_ORGANIZATIONS_SORTABLE = [
  "createdAt",
  "updatedAt",
  "slug",
  "name",
  "kind",
] as const;

export const LIST_ORGANIZATIONS_FILTERABLE = {
  kind: { ops: ["eq", "in"], value: z.enum(ORGANIZATION_KINDS) },
  slug: { ops: ["eq", "like"], value: slugSchema },
  createdAt: { ops: ["gt", "gte", "lt", "lte"], value: z.coerce.date() },
  deletedAt: { ops: ["null"] },
} satisfies FilterSpec;

/** `GET /api/v1/admin/organizations`. `q` searches name and slug. */
export const listOrganizationsQuery = listQuerySchema({
  sortable: LIST_ORGANIZATIONS_SORTABLE,
  filterable: LIST_ORGANIZATIONS_FILTERABLE,
  defaultSort: "-createdAt",
  searchable: true,
});
export type ListOrganizationsQuery = z.infer<typeof listOrganizationsQuery>;

/**
 * `GET .../memberships` and `GET /user/orgs/:orgId/members`.
 *
 * No `q` and no searchable columns: search would reach `users.email` across a
 * join, and the only rows this can ever return are the members of one
 * organization — a set the caller can already see in full. Adding a search
 * would buy nothing and would put an address column into a query string.
 *
 * `createdAt` and `role` are the two orders the members list offers, and both
 * are served by a **tenant-led** composite (ADR-0067 §1): the pagination key
 * on this table is `(organization_id, column, user_id)`, there being no `id`.
 */
export const LIST_MEMBERSHIPS_SORTABLE = ["createdAt", "role"] as const;

export const LIST_MEMBERSHIPS_FILTERABLE = {
  role: { ops: ["eq", "in"], value: z.enum(ORGANIZATION_ROLES) },
} satisfies FilterSpec;

export const listMembershipsQuery = listQuerySchema({
  sortable: LIST_MEMBERSHIPS_SORTABLE,
  filterable: LIST_MEMBERSHIPS_FILTERABLE,
  defaultSort: "-createdAt",
  searchable: false,
});
export type ListMembershipsQuery = z.infer<typeof listMembershipsQuery>;

/**
 * `GET /api/v1/user/orgs/:orgId/invitations` — the pending ones.
 *
 * **`tokenHash` is in no allow-list here, and its absence is load-bearing.**
 * The column is unique, and `indexCoverage` reports a unique column as
 * covered — so the index side of ADR-0060 §3 would happily accept
 * `sort=tokenHash`, and this allow-list is the only thing that keeps a
 * credential digest out of a query string and out of an ordered page.
 */
export const LIST_INVITATIONS_SORTABLE = ["createdAt", "updatedAt"] as const;

/**
 * `email` alone, and `role` deliberately absent (ADR-0060 §3).
 *
 * A pending list belongs to one organization and is small, so filtering it by
 * role buys nothing — and the rule is that a column enters an allow-list only
 * with its index in the same step. `(organization_id, email, id)` exists;
 * `(organization_id, role, …)` does not, and adding an index to serve a filter
 * nobody needs is a write cost on every invitation ever created.
 */
export const LIST_INVITATIONS_FILTERABLE = {
  email: { ops: ["eq"], value: emailSchema },
} satisfies FilterSpec;

export const listInvitationsQuery = listQuerySchema({
  sortable: LIST_INVITATIONS_SORTABLE,
  filterable: LIST_INVITATIONS_FILTERABLE,
  defaultSort: "-createdAt",
  searchable: false,
});
export type ListInvitationsQuery = z.infer<typeof listInvitationsQuery>;

/*
 * `GET /api/v1/user/orgs` has **no schema and no list language**, which is a
 * decision rather than an omission (ADR-0014 as carried by ADR-0060). It is
 * the switcher's query: scoped by the principal rather than by a tenant
 * (ADR-0067 §5), and a user belongs to a handful of organizations rather than
 * a page of them. A pagination language over a list nothing paginates would be
 * a query string no client sends and an allow-list no index has to serve.
 */
