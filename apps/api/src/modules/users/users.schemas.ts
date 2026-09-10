import {
  changeEmailBody,
  changePasswordBody,
  createUserBody,
  deleteProfileBody,
  listUsersQuery,
  setPasswordBody,
  updateProfileBody,
  updateUserBody,
  userIdParams,
} from "@repo/contracts";

/**
 * The route schemas of the users module (ADR-0011).
 *
 * Re-exported from `@repo/contracts` rather than declared here (ADR-0023), so
 * the admin panel and the web app validate the same forms against the same
 * objects. One module serves two segments (ADR-0009): the `…User…` schemas
 * belong to `/api/v1/admin/users`, the `…Profile…` ones to
 * `/api/v1/user/profile`, and the difference between them — no `status`, no
 * `roles` — is the reason a user cannot promote themselves by editing their
 * own profile.
 */

export const listUsersSchema = { query: listUsersQuery } as const;
export const getUserSchema = { params: userIdParams } as const;
export const createUserSchema = { body: createUserBody } as const;
export const updateUserSchema = {
  params: userIdParams,
  body: updateUserBody,
} as const;
export const revokeUserSessionsSchema = { params: userIdParams } as const;

/** `DELETE /api/v1/admin/users/:id` (ADR-0028). No body — see the staff one. */
export const deleteUserSchema = { params: userIdParams } as const;

/**
 * `POST /api/v1/admin/users/:id/password` — the administrative reset
 * (ADR-0027).
 *
 * `currentPassword` here is the **acting staff member's**, not the subject's:
 * the id in the path says whose password is being set, and the body says who
 * is asking.
 */
export const setUserPasswordSchema = {
  params: userIdParams,
  body: setPasswordBody,
} as const;

export const updateProfileSchema = { body: updateProfileBody } as const;

/**
 * `POST /api/v1/user/profile/change-email` — asking to move to a new address
 * (ADR-0071 §6).
 *
 * No `params`, like every other route on this segment: the subject is
 * `ctx.principal`, so there is no id for a caller to point at somebody else's
 * account with (ADR-0019 §3). The confirmation half is on the public segment
 * and validates {@link confirmEmailSchema} in the auth module — the link is
 * followed from a mailbox rather than from this session.
 */
export const changeEmailSchema = { body: changeEmailBody } as const;
export const changePasswordSchema = { body: changePasswordBody } as const;

/**
 * `DELETE /api/v1/user/profile` — self-service deletion (ADR-0055 §4).
 *
 * The one `DELETE` in this API with a body, and the reason is the same one
 * ADR-0027 gives for `change-password`: the actor re-authenticates, because a
 * session is not an identity proof for an irreversible act. The admin
 * `deleteUserSchema` above takes no body for the opposite reason — there the
 * actor is staff acting on somebody else, already fenced by the role guard.
 */
export const deleteProfileSchema = { body: deleteProfileBody } as const;
