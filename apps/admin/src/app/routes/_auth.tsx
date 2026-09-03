import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { useRouteDescription, useRouteTitle } from "@/shared/lib/route-meta";
import { AuthLayout } from "@/shared/ui";

/**
 * The unauthenticated half of ADR-0032 §Layout topology — a pathless layout
 * route, so `/login` renders inside the auth shell without `login` appearing
 * twice in the URL. That shell was `login-01` until `D11.7` replaced it with
 * ADR-0054 §7's composition; the topology is unchanged.
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
  /*
   * Both from the route, on `D11.3`'s channel (`route-meta`). The description
   * arrived at `D11.7`, when ADR-0054 §7's card stopped holding the sentence
   * about the screen and the heading block took it — so the shell reads it the
   * same way the dashboard's page-header band does, and neither layout holds a
   * table of which path says what.
   */
  const title = useRouteTitle("auth:title");
  const description = useRouteDescription();

  return (
    <AuthLayout description={description} title={title}>
      <Outlet />
    </AuthLayout>
  );
}
