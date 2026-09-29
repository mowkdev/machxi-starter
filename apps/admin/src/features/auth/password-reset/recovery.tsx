import { createPasswordRecovery, type RecoveryNavigation } from "@repo/account";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";

import { useMessageForError } from "@/shared/notifications/messages";

/**
 * Password recovery, bound to this app's router and catalogue (ADR-0071 §4;
 * the forms and the hook are `@repo/account`'s since `D22.2`, ADR-0077 §2–§3).
 *
 * What is written here is what a package may not name: a router types its
 * destinations against this app's own route tree, so the link to
 * `/forgot-password`, the strike of the fragment and the landing on `/login`
 * leave the package as a rendered child and two callbacks.
 *
 * **No outcome sentence is passed**, which is the one difference from the
 * customer app's binding: a reset here lands on sign-in in silence, as it
 * always has.
 */
const useLocationHash = (): string =>
  useRouterState({ select: (state) => state.location.hash });

const useRecoveryNavigation = (): RecoveryNavigation => {
  const navigate = useNavigate();

  // Memoised because the strike is a dependency of the hook's effect.
  return useMemo(
    () => ({
      strikeToken: () =>
        navigate({ to: "/reset-password", hash: "", replace: true }),
      toSignIn: () => navigate({ to: "/login", search: {}, replace: true }),
    }),
    [navigate],
  );
};

const RequestLink = ({
  className,
  children,
}: {
  readonly className: string;
  readonly children: ReactNode;
}) => (
  <Link className={className} to="/forgot-password">
    {children}
  </Link>
);

export const { ForgotPasswordForm, ResetPasswordForm, useResetPassword } =
  createPasswordRecovery({
    useMessageForError,
    useLocationHash,
    useRecoveryNavigation,
    RequestLink,
  });
