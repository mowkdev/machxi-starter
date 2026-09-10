import {
  acceptInvitationByTokenBody,
  addMembershipBody,
  createInvitationBody,
  createOrganizationAdminBody,
  createOrganizationBody,
  invitationIdParams,
  listInvitationsQuery,
  listMembershipsQuery,
  listOrganizationsQuery,
  lookupInvitationBody,
  membershipParams,
  membershipRoleBody,
  organizationIdParams,
  organizationMembershipParams,
  orgIdParams,
  orgInvitationParams,
  updateOrganizationBody,
} from "@repo/contracts";

/**
 * The route schemas of the organizations module (ADR-0011).
 *
 * Re-exported from `@repo/contracts` rather than declared here (ADR-0023), so
 * both SPAs validate the same forms against the same objects.
 *
 * One module, three mounts (ADR-0067 §3, §4), and the naming says which is
 * which: `…OrgSchema` belongs to `/api/v1/user/orgs`, `…MyInvitation…` to the
 * self-scoped `/api/v1/user/invitations`, and `…OrganizationSchema` to
 * `/api/v1/admin/organizations`.
 *
 * The user-segment schemas parse `:orgId` even though `requireMembership`
 * already did, and neither parse is redundant: the guard's is what lets it
 * read the database safely at the mount, above every route, and this one is
 * what lets a handler read `req.valid.params` rather than `req.params`
 * (ADR-0009). The handlers then take the organization from `ctx` rather than
 * from either — only the guard that checked writes that field.
 */

/* ── /api/v1/user/orgs (ADR-0067 §4) ──────────────────────────────────────── */

export const createOrgSchema = { body: createOrganizationBody } as const;
export const getOrgSchema = { params: orgIdParams } as const;
export const updateOrgSchema = {
  params: orgIdParams,
  body: updateOrganizationBody,
} as const;
export const deleteOrgSchema = { params: orgIdParams } as const;

export const listOrgMembersSchema = {
  params: orgIdParams,
  query: listMembershipsQuery,
} as const;
export const setOrgMemberRoleSchema = {
  params: membershipParams,
  body: membershipRoleBody,
} as const;
export const removeOrgMemberSchema = { params: membershipParams } as const;

export const createOrgInvitationSchema = {
  params: orgIdParams,
  body: createInvitationBody,
} as const;
export const listOrgInvitationsSchema = {
  params: orgIdParams,
  query: listInvitationsQuery,
} as const;
export const revokeOrgInvitationSchema = {
  params: orgInvitationParams,
} as const;

/* ── /api/v1/user/invitations — self-scoped (ADR-0067 §4) ─────────────────── */

export const actOnMyInvitationSchema = { params: invitationIdParams } as const;
/**
 * `POST /api/v1/user/invitations/accept-by-token` — the link, redeemed by the
 * signed-in account (ADR-0071 §5).
 *
 * No params: the invitation is named by the token in the body, so there is no
 * id in the path for a caller to swap.
 */
export const acceptMyInvitationByTokenSchema = {
  body: acceptInvitationByTokenBody,
} as const;

/* ── /api/v1/public/invitations — the link, before a session (ADR-0071 §5) ── */

export const lookupInvitationSchema = { body: lookupInvitationBody } as const;

/* ── /api/v1/admin/organizations (ADR-0067 §3) ────────────────────────────── */

export const listOrganizationsSchema = {
  query: listOrganizationsQuery,
} as const;
export const getOrganizationSchema = { params: organizationIdParams } as const;
export const createOrganizationSchema = {
  body: createOrganizationAdminBody,
} as const;
export const updateOrganizationSchema = {
  params: organizationIdParams,
  body: updateOrganizationBody,
} as const;
export const deleteOrganizationSchema = {
  params: organizationIdParams,
} as const;

export const listOrganizationMembersSchema = {
  params: organizationIdParams,
  query: listMembershipsQuery,
} as const;
export const addOrganizationMemberSchema = {
  params: organizationIdParams,
  body: addMembershipBody,
} as const;
export const setOrganizationMemberRoleSchema = {
  params: organizationMembershipParams,
  body: membershipRoleBody,
} as const;
export const removeOrganizationMemberSchema = {
  params: organizationMembershipParams,
} as const;
