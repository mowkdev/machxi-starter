export { LoginForm } from "./login/login-form";
export { RegisterForm, type RegisterFormProps } from "./register/register-form";
export { useSignOut, type SignOut } from "./logout/use-sign-out";
/*
 * Password recovery is `@repo/account`'s since `D22.2` (ADR-0077 §2–§3), and
 * this slice is its door: `./password-reset/recovery` binds the forms and the
 * hook to this app's router, catalogue and outcome sentence.
 */
export {
  ForgotPasswordForm,
  ResetPasswordForm,
  useResetPassword,
} from "./password-reset/recovery";
export type { PasswordReset, PasswordResetStatus } from "@repo/account";
export {
  useConfirmEmail,
  type EmailChangeStatus,
} from "./email-change/use-confirm-email";
export { useAwaitedAddress } from "./verify-email/awaited-address";
export { ResendVerificationForm } from "./verify-email/resend-verification-form";
export {
  useVerifyEmail,
  type VerificationStatus,
} from "./verify-email/use-verify-email";
export {
  ContinueWithGoogle,
  type ContinueWithGoogleProps,
} from "./google-sign-in/continue-with-google";
export {
  identityLinkRefused,
  identityLinked,
  useGoogleLanding,
  type GoogleLanding,
  type GoogleLandingStatus,
} from "./google-sign-in/use-google-landing";
export {
  SignInMethodsCard,
  type SignInMethodsCardProps,
} from "./sign-in-methods/sign-in-methods-card";
export {
  SetPasswordControl,
  SetPasswordFirst,
  type SetPasswordControlProps,
} from "./sign-in-methods/set-password-control";
export {
  UnlinkGoogleDialog,
  unlinkGoogleFields,
} from "./sign-in-methods/unlink-google-dialog";
