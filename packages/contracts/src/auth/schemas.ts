import { z } from "zod";

import { customRule } from "../locales/source.js";
import {
  emailSchema,
  nameSchema,
  passwordSchema,
  presentedPasswordSchema,
} from "../primitives.js";

/**
 * Request schemas for the authentication endpoints of both populations
 * (ADR-0018). The same three bodies serve `/api/v1/admin/auth/*`,
 * `/api/v1/user/auth/*` and `/api/v1/public/auth/register` — the population is
 * carried by the route segment (ADR-0015), never by a field in the body, so a
 * client cannot ask to be authenticated as the other population.
 *
 * `logout`, `logout-all` and `me` take no body and therefore have no schema.
 */

/**
 * `POST /api/v1/{admin,user}/auth/login`.
 *
 * The password is bounded but **not** held to the password policy: a policy
 * check here would reject a short password with `400` before any credential
 * comparison, which both advertises the policy and distinguishes "too short to
 * be one of ours" from "wrong" (ADR-0018 §Login step 3 requires one answer for
 * every failure).
 */
export const loginBody = z.strictObject({
  email: emailSchema,
  password: presentedPasswordSchema,
});
export type LoginBody = z.infer<typeof loginBody>;

/** Upper bound on a submitted refresh token. */
export const MAX_REFRESH_TOKEN_LENGTH = 512;

/**
 * The opaque refresh token as the client sends it back.
 *
 * Only bounded, not format-checked. Today it is 32 random bytes base64url
 * (ADR-0018), but the browser-cookie transport in a future ADR may change the
 * encoding, and a regex here would make that an API-breaking change for no
 * security gain — an unknown token is rejected by the hash lookup either way.
 */
export const refreshTokenSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_REFRESH_TOKEN_LENGTH);

/**
 * `POST /api/v1/{admin,user}/auth/refresh`.
 *
 * Optional since ADR-0029: a browser on cookie transport sends nothing in the
 * body and the server reads `__Secure-machxi.refresh` instead. A request with
 * neither is refused by the controller as a validation error — the schema
 * cannot express "one of these two", because the other one is not a field.
 */
export const refreshBody = z.strictObject({
  refreshToken: refreshTokenSchema.optional(),
});
export type RefreshBody = z.infer<typeof refreshBody>;

/**
 * `POST /api/v1/public/auth/register` — user self-registration, mounted only
 * when `FEATURE_USER_REGISTRATION` is on (ADR-0004). Names are optional
 * because the `users` table allows them to be null (ADR-0017); staff have no
 * self-registration path at all.
 */
export const registerBody = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
});
export type RegisterBody = z.infer<typeof registerBody>;

/**
 * `POST /api/v1/{admin,user}/profile/change-password` — an account changing
 * its own password (ADR-0027).
 *
 * It lives here rather than in `users/` because it is a credential shape used
 * by both populations, and ADR-0023's "defined once" rule puts a shape its
 * consumers share above the module that happened to need it first.
 *
 * `currentPassword` is only bounded, not held to the policy: it is a
 * credential being verified, and an account whose password predates a policy
 * change must still be able to change it.
 */
export const changePasswordBody = z
  .strictObject({
    currentPassword: presentedPasswordSchema,
    newPassword: passwordSchema,
  })
  .refine((body) => body.newPassword !== body.currentPassword, {
    path: ["newPassword"],
    ...customRule("passwordMustDiffer"),
  });
export type ChangePasswordBody = z.infer<typeof changePasswordBody>;

/**
 * `POST /api/v1/admin/{staff,users}/:id/password` — a staff member setting
 * somebody else's password (ADR-0027).
 *
 * The two fields belong to two different people: `password` is the subject's
 * new credential and is held to the policy, while `currentPassword` is the
 * **acting staff member's own** and is only bounded, for the reason
 * `presentedPasswordSchema` exists. That is also why there is no "must differ"
 * refinement here — the two values have no relationship worth asserting, and
 * one that compared them would leak whether the actor and the subject share a
 * password.
 */
export const setPasswordBody = z.strictObject({
  password: passwordSchema,
  currentPassword: presentedPasswordSchema,
});
export type SetPasswordBody = z.infer<typeof setPasswordBody>;

/**
 * Upper bound on a submitted impersonation handoff token.
 *
 * The same bound {@link MAX_REFRESH_TOKEN_LENGTH} puts on the other opaque
 * credential, and it matters more here: this value arrives from a **URL
 * fragment** the customer app reads off `location.hash` and posts on, so its
 * length is whatever a pasted link happened to contain.
 */
export const MAX_HANDOFF_TOKEN_LENGTH = 512;

/**
 * The opaque one-time handoff token, as the customer app sends it back
 * (ADR-0057 §2).
 *
 * Bounded and not format-checked, for the reason {@link refreshTokenSchema}
 * gives: the encoding is the mint's business, and an unknown token is refused
 * by the hash lookup either way.
 */
export const handoffTokenSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_HANDOFF_TOKEN_LENGTH);

/**
 * `POST /api/v1/user/auth/impersonate` — the exchange (ADR-0057 §3).
 *
 * Unauthenticated: the token *is* the credential. The route registers on the
 * `user` segment only, because an admin-segment twin would be a way to mint a
 * staff session from a URL.
 */
export const impersonateBody = z.strictObject({
  token: handoffTokenSchema,
});
export type ImpersonateBody = z.infer<typeof impersonateBody>;
