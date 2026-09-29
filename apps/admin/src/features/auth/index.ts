export { LoginForm } from "./login/login-form";
export { LogoutMenuItem } from "./logout/logout-menu-item";
export { OnboardingForm } from "./onboarding/onboarding-form";
export {
  useAcceptOnboarding,
  type Onboarding,
  type OnboardingStatus,
} from "./onboarding/use-accept-onboarding";
/*
 * Password recovery is `@repo/account`'s since `D22.2` (ADR-0077 §2–§3), and
 * this slice is its door: `./password-reset/recovery` binds the forms and the
 * hook to this app's router and catalogue.
 */
export {
  ForgotPasswordForm,
  ResetPasswordForm,
  useResetPassword,
} from "./password-reset/recovery";
export type { PasswordReset, PasswordResetStatus } from "@repo/account";
