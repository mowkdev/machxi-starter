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
 * **The outcome sentence is this app's** (ADR-0072 §4, amended between `D19.2`
 * and `D19.3`). A reset lands on `/login` with no session, and what it did to
 * the account — a new password, and possibly Google unlinked, since a reset by
 * mail removes every federated identity — has to be said on the screen it
 * lands on. ADR-0034's one global handler delivers it to the `<Toaster>` on
 * the root route, which survives that navigation.
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
    outcome: "auth:reset.done",
  });
