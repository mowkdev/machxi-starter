import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { AuthLayout } from "@/widgets/auth-layout";

import { useRouteTitle } from "@/shared/lib/route-title";

/**
 * The unauthenticated half of ADR-0032 §Layout topology — a pathless layout
 * route, so `/login` renders inside the `login-01` shell without `login`
 * appearing twice in the URL.
 *
 * The mirror of `_dashboard`: an operator who already has a session has no
 * business on the login screen, so they are sent to the dashboard. With the
 * `D3.3` session stub answering `true` unconditionally this redirect fires for
 * everyone, which is why the stub is the one thing `D3.4` must replace before
 * the login screen can be used at all.
 */
export const Route = createFileRoute("/_auth")({
  beforeLoad: ({ context }) => {
    if (context.session.isAuthenticated()) {
      throw redirect({ to: "/" });
    }
  },
  component: AuthShell,
});

function AuthShell() {
  return (
    <AuthLayout title={useRouteTitle("Sign in")}>
      <Outlet />
    </AuthLayout>
  );
}
