import {
  conflict,
  forbidden,
  unauthenticated,
  type AppError,
} from "../../core/errors/index.js";

/**
 * The auth module's error factories (ADR-0013).
 *
 * Thin wrappers over the generic ones: they fix the `code` and the message and
 * inherit the status, so there is no new error type and no `instanceof` check
 * anywhere. What the client branches on is the code — the table in
 * `@repo/contracts` says what each one means and what a client should do next.
 */

/**
 * Unknown email **or** wrong password, deliberately indistinguishable
 * (ADR-0018 §Login step 3). One message, one code, one status: anything that
 * differs between the two cases is an account-existence oracle.
 */
export const invalidCredentials = (): AppError =>
  unauthenticated("Invalid email or password", "AUTH_INVALID_CREDENTIALS");

/**
 * Credentials were correct but the account is not `active` (403).
 *
 * Raised only **after** the password verified, which is what keeps it from
 * telling an anonymous caller that an address exists.
 */
export const accountDisabled = (): AppError =>
  forbidden("This account is not active", "AUTH_ACCOUNT_DISABLED");

/**
 * The password verified, but the address behind it has never been proven
 * (ADR-0071 §3).
 *
 * **Distinguishable from {@link accountDisabled}, and that is the decision.**
 * ADR-0020 §Enumeration protects an anonymous caller from learning which
 * addresses exist; this is raised only *after* the password verified, so the
 * caller has already proven they hold the account and there is nothing left to
 * protect. Answering "this account is disabled, contact support" to somebody
 * who simply has not opened their mail would be a support ticket the API could
 * have answered itself, and the client's next move — offer to send the link
 * again — is one it can only make if it is told.
 *
 * `403` for the reason its neighbours are: the credential is fine, the
 * operation is refused.
 */
export const emailUnverified = (): AppError =>
  forbidden("This address has not been confirmed yet", "AUTH_EMAIL_UNVERIFIED");

/**
 * Every way `POST /public/auth/verify-email` can fail, answered as one
 * indistinguishable `401` (ADR-0071 §3).
 *
 * Unknown token, already consumed, minted for the other purpose or population,
 * past `VERIFICATION_TOKEN_TTL`, or naming an account that is no longer one a
 * link may act on — one answer, because the caller is an anonymous holder of a
 * URL fragment and every distinction between those cases is something for them
 * to learn. The same posture {@link impersonationHandoffInvalid} takes, for
 * the same reason and with the same **generic** `UNAUTHENTICATED` code: the
 * only client is the SPA's `/verify-email` screen, which has one thing to say
 * either way — ask for a new link.
 */
export const verificationLinkInvalid = (): AppError =>
  unauthenticated("This confirmation link is no longer valid");

/**
 * Every way `POST /{admin,user}/auth/password/reset` can fail, answered as one
 * indistinguishable `401` (ADR-0071 §4).
 *
 * {@link verificationLinkInvalid}'s posture on the other single-use link, and
 * for its reasons: unknown token, already consumed, minted for the other
 * purpose or the other population, past `PASSWORD_RESET_TOKEN_TTL`, or naming
 * an account that has since been disabled or deleted — one answer, because the
 * caller is an anonymous holder of a URL fragment and every distinction is
 * something for them to learn.
 *
 * The **generic** `UNAUTHENTICATED` code, again for the shipped reason: the
 * only client is each SPA's `/reset-password` screen, which has one thing to
 * say either way — ask for a new link — so a code of its own would be enum
 * growth with no reader.
 */
export const passwordResetLinkInvalid = (): AppError =>
  unauthenticated("This password reset link is no longer valid");

/**
 * Every way `POST /public/auth/confirm-email` can fail **except** the one a
 * person can act on, answered as one indistinguishable `401` (ADR-0071 §6).
 *
 * {@link verificationLinkInvalid}'s posture on the third single-use link:
 * unknown token, already consumed, minted for another purpose or population,
 * past `EMAIL_CHANGE_TOKEN_TTL`, or naming an account that has since been
 * disabled or deleted — one answer, because the caller is an anonymous holder
 * of a URL fragment.
 *
 * The exception is deliberate and it is the one case the screen can do
 * something with: an address that a live account has taken since the request
 * answers `409 USER_EMAIL_TAKEN`, because the holder of this link has already
 * been told which address it is — it is the mailbox the message arrived in —
 * so there is no existence to conceal, and "somebody else took it" is the only
 * refusal here that a different address would fix.
 */
export const emailChangeLinkInvalid = (): AppError =>
  unauthenticated("This address confirmation link is no longer valid");

/**
 * Every way `POST /admin/auth/onboarding/accept` can fail, answered as one
 * indistinguishable `401` (ADR-0071 §8).
 *
 * {@link verificationLinkInvalid}'s posture on the fourth single-use link, and
 * with no exception at all: unknown token, already consumed, minted for
 * another purpose or population, past `STAFF_ONBOARDING_TOKEN_TTL`, or naming
 * a row that has left `invited` — onboarded already, or disabled by an admin
 * since the message went out. The caller is an anonymous holder of a URL
 * fragment and none of those distinctions is theirs to learn; the one screen
 * that reads this says the same sentence to all of them — ask an
 * administrator for another link.
 */
export const onboardingLinkInvalid = (): AppError =>
  unauthenticated("This onboarding link is no longer valid");

/** Missing, malformed, wrongly signed, or carrying the other population's `aud`. */
export const tokenInvalid = (): AppError =>
  unauthenticated("Invalid access token", "AUTH_TOKEN_INVALID");

/** Past `exp`, everything else valid — the client should refresh and retry. */
export const tokenExpired = (): AppError =>
  unauthenticated("Access token expired", "AUTH_TOKEN_EXPIRED");

/**
 * The token verifies but its session no longer does: logged out here or
 * elsewhere, revoked by an admin, or past the refresh token's expiry.
 */
export const sessionRevoked = (): AppError =>
  unauthenticated("Session is no longer valid", "AUTH_SESSION_REVOKED");

/** The refresh token is unknown, expired, or belongs to the other population. */
export const invalidRefreshToken = (): AppError =>
  unauthenticated("Invalid refresh token", "AUTH_INVALID_REFRESH_TOKEN");

/**
 * A rotated refresh token was replayed outside the grace window. The session
 * is revoked before this is thrown (ADR-0018 §Refresh step 4) — the token is
 * assumed stolen, and the client should re-login and be warned.
 */
export const refreshReused = (): AppError =>
  unauthenticated(
    "Refresh token was already used; the session has been revoked",
    "AUTH_REFRESH_REUSED",
  );

/**
 * The caller re-presented their **own** current password and it did not
 * verify (ADR-0027).
 *
 * Raised by all four credential-setting endpoints — both
 * `profile/change-password` routes, where the caller is the subject, and both
 * `POST /admin/{staff,users}/:id/password`, where they are not. It lives in
 * the auth module rather than in either feature module because the question is
 * about the credential check and not about an aggregate; a copy per module
 * would be the same asymmetry ADR-0027 was written to remove.
 *
 * `403`, not `401`: the caller's session is valid and stays valid, so a `401`
 * would be untrue about the request and would send every client interceptor
 * that reads `401` as "the session died" to the login screen over a typo.
 */
export const currentPasswordInvalid = (): AppError =>
  forbidden(
    "The current password is incorrect",
    "AUTH_CURRENT_PASSWORD_INVALID",
  );

/**
 * Every way the impersonation exchange can fail, answered as one
 * indistinguishable `401` (ADR-0057 §3, amended `D13.4`).
 *
 * Unknown token, already consumed, past `IMPERSONATION_HANDOFF_TTL`, target
 * deleted or disabled, minting staff member gone — one answer, because the
 * caller of this endpoint is an anonymous holder of a URL fragment and every
 * distinction between those cases is something for them to learn. It is the
 * same posture `invalidCredentials` takes, applied to the other opaque
 * credential in the system.
 *
 * The **generic** `UNAUTHENTICATED` code rather than one of its own, and that
 * is the decision `D13.4` recorded in ADR-0057 §3: `AUTH_IMPERSONATION_REFUSED`
 * belongs to the exclusion list (§5, a `403` on a live session) and would be
 * wrong here, and a fourth handoff-shaped code would be enum growth whose only
 * reader — the customer app's `/impersonate` screen — has one thing to say
 * either way. Nothing branches on it, and every already-shipped bundle already
 * renders it.
 */
export const impersonationHandoffInvalid = (): AppError =>
  unauthenticated("This impersonation link is no longer valid");

/**
 * A registration whose email is already taken.
 *
 * Plain `CONFLICT`, never `USER_EMAIL_TAKEN`: this endpoint is anonymous, and
 * a code that names the conflict turns it into an account-existence oracle
 * (ADR-0020 §Enumeration). `USER_EMAIL_TAKEN` is reserved for the
 * authenticated `POST /api/v1/admin/users`, where the caller is staff and may
 * be told exactly what went wrong.
 */
export const registrationConflict = (): AppError =>
  conflict("Registration could not be completed");

/**
 * An excluded operation attempted on an impersonated session (ADR-0057 §5).
 *
 * **One code for the class**, not one per operation: the client already knows
 * which dialog the refusal came from, so a code per operation would be enum
 * growth with no reader (the record says so, and the catalogue entries both
 * apps grew at `D13.3` are the one sentence either way).
 *
 * `403`, not `401`, and the distinction is load-bearing: the session is
 * perfectly valid and stays valid — it is the *operation* that is refused —
 * and `AUTH_IMPERSONATION_REFUSED` is deliberately outside `TERMINAL_AUTH_CODES`
 * so no client interceptor reads a refused password change as a dead session
 * and signs the operator out of an impersonation they are in the middle of.
 */
export const impersonationRefused = (): AppError =>
  forbidden(
    "This operation is not available while impersonating an account",
    "AUTH_IMPERSONATION_REFUSED",
  );

/**
 * Every way `POST /public/auth/google/exchange` can fail, answered as one
 * indistinguishable `401` (ADR-0072 §2, `verify-email`'s posture inherited
 * whole).
 *
 * Unknown token, already exchanged, past `FEDERATED_HANDOFF_TTL`, minted for
 * another purpose, or naming an account that stopped being `active` in the
 * seconds since the callback — one answer, because the caller is an anonymous
 * holder of a URL fragment. The **generic** `UNAUTHENTICATED` code for
 * {@link impersonationHandoffInvalid}'s reason: the one screen that reads it
 * has one thing to say either way — sign in again.
 */
export const federatedHandoffInvalid = (): AppError =>
  unauthenticated("This sign-in link is no longer valid");

/**
 * A sign-in with Google found no account, and `FEATURE_USER_REGISTRATION`
 * says none may be made here (ADR-0072 §1).
 *
 * The flag means "may new accounts be made here", and a second door does not
 * change what it means. Never an envelope: the callback answers it as
 * `#error=AUTH_FEDERATED_SIGNUP_CLOSED` on a redirect (§2).
 */
export const federatedSignupClosed = (): AppError =>
  forbidden(
    "New accounts cannot be created here",
    "AUTH_FEDERATED_SIGNUP_CLOSED",
  );

/**
 * A sign-in with Google whose address Google does not host, held by a live
 * account (ADR-0072 §1, amended at `D19.1`).
 *
 * Google's "verified" means "controls it now" only for an address it hosts;
 * for any other it means "controlled it once", and linking on that would hand
 * an existing account to whoever held the mailbox then. The person signs in
 * with the password and links Google from the security section, which proves
 * both sides at once. Redirect-only, like its neighbour.
 *
 * `D19.2` answered it for an address **nobody** holds as well; the operator
 * withdrew that at `D19.4` (§1's last amendment), because a reset now removes
 * every identity, so creation on such an address is recovered by its mailbox.
 */
export const federatedLinkRequired = (): AppError =>
  forbidden(
    "Google cannot confirm this address for an existing account; sign in with the password, then link Google from the account's security settings",
    "AUTH_FEDERATED_LINK_REQUIRED",
  );

/**
 * A link whose Google account another account already signs in with
 * (ADR-0072 §3).
 *
 * `409`, `USER_EMAIL_TAKEN`'s reasoning for a subject: the caller may link,
 * and what the request conflicts with is another account's state. Telling the
 * caller is safe where it would not be on the sign-in — they have just proven
 * control of the Google account at the provider, so "it is linked elsewhere"
 * is a fact about something they hold. Redirect-only: it reaches the customer
 * app as `#error=AUTH_IDENTITY_TAKEN` (§2).
 */
export const identityTaken = (): AppError =>
  conflict(
    "This identity is already linked to another account",
    "AUTH_IDENTITY_TAKEN",
  );

/**
 * An unlink that would leave the account with no way in (ADR-0072 §3): the
 * account has no password, so this identity is its last credential.
 *
 * Checked **before** the current password, and that order is the only one
 * that means anything — a passwordless account has no current password to
 * present, so asking for one would answer `AUTH_CURRENT_PASSWORD_INVALID`
 * about a password that does not exist. The customer app offers the
 * set-password link instead.
 */
export const lastCredential = (): AppError =>
  conflict(
    "This is the account's only way to sign in; set a password first",
    "AUTH_LAST_CREDENTIAL",
  );
