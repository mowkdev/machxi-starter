import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { AuthLayout } from "@/widgets/auth-layout";

import { useRouteTitle } from "@/shared/lib/route-meta";

/**
 * The unauthenticated half of ADR-0032 §Layout topology — a pathless layout
 * route, so `/login` renders inside the `login-01` shell without `login`
 * appearing twice in the URL.
 *
 * The mirror of `_dashboard`: an operator who already has a session has no
 * business on the login screen, so they are sent to the dashboard. Since `D3.4`
 * the answer comes from the real store (ADR-0033), which the boot sequence has
 * already hydrated by the time any guard runs — that ordering is what
 * `SessionProvider`'s loading gate exists to guarantee.
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
    <AuthLayout title={useRouteTitle("auth:title")}>
      <Outlet />
    </AuthLayout>
  );
}
