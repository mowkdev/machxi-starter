import {
  acceptOnboardingBody,
  confirmEmailBody,
  forgotPasswordBody,
  loginBody,
  refreshBody,
  registerBody,
  resendVerificationBody,
  resetPasswordBody,
  verifyEmailBody,
} from "@repo/contracts";

/**
 * The route schemas of the auth module (ADR-0011).
 *
 * They are re-exported from `@repo/contracts` rather than declared here
 * (ADR-0023): the admin panel and the web app validate the same login form
 * against the same object, so a field the server rejects is a field the client
 * never sends. A server-only refinement — one a client could not evaluate —
 * would be added on top of the imported schema, in this file.
 *
 * Grouped as `{ params?, query?, body? }` because that is what `validate()`
 * takes and what `ValidatedRequest<typeof schema>` reads to type `req.valid`.
 * `logout`, `logout-all` and `me` take no input at all and therefore mount no
 * validator.
 */

export const loginSchema = { body: loginBody } as const;
export const refreshSchema = { body: refreshBody } as const;
export const registerSchema = { body: registerBody } as const;
export const verifyEmailSchema = { body: verifyEmailBody } as const;
export const resendVerificationSchema = {
  body: resendVerificationBody,
} as const;
export const confirmEmailSchema = { body: confirmEmailBody } as const;
export const forgotPasswordSchema = { body: forgotPasswordBody } as const;
export const resetPasswordSchema = { body: resetPasswordBody } as const;

/**
 * `POST /api/v1/admin/auth/onboarding/accept` (ADR-0071 §8) — the admin
 * segment's only route registered above `authenticate`, besides `login` and
 * the recovery pair.
 */
export const acceptOnboardingSchema = { body: acceptOnboardingBody } as const;
