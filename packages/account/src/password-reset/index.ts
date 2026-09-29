import type { ComponentType, ReactNode } from "react";

import {
  createForgotPasswordForm,
  type ForgotPasswordDeps,
} from "./forgot-password-form";
import { createResetPasswordForm } from "./reset-password-form";
import {
  createUseResetPassword,
  type ResetPasswordDeps,
} from "./use-reset-password";

/**
 * Password recovery, bound once per app (`D22.2`, ADR-0077 §2–§3).
 *
 * Everything the two apps' copies differed in, or that a package may not
 * name, is a member of the one object an app's `features/auth` slice passes:
 * its code map, its router's reading of the address and its two navigations,
 * the link to its own `/forgot-password`, and the outcome sentence where it
 * has one.
 */
export interface PasswordRecoveryDeps
  extends ForgotPasswordDeps, ResetPasswordDeps {
  readonly RequestLink: ComponentType<{
    readonly className: string;
    readonly children: ReactNode;
  }>;
}

export const createPasswordRecovery = (deps: PasswordRecoveryDeps) => {
  const useResetPassword = createUseResetPassword(deps);

  return {
    ForgotPasswordForm: createForgotPasswordForm(deps),
    ResetPasswordForm: createResetPasswordForm({
      useResetPassword,
      RequestLink: deps.RequestLink,
    }),
    useResetPassword,
  } as const;
};

export type {
  PasswordReset,
  PasswordResetStatus,
  RecoveryNavigation,
} from "./use-reset-password";
