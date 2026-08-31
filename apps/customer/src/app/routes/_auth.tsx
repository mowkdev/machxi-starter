import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { AuthLayout } from "@/widgets/auth-layout";

import { useRouteDescription, useRouteTitle } from "@/shared/lib/route-meta";

/**
 * The unauthenticated half of ADR-0049 §Layout topology — a pathless layout
 * route, so `/login` renders inside the auth shell without `login` appearing
 * twice in the URL.
 *
 * The mirror of `_dashboard`: someone who already has a session has no business
 * on the login screen, so they are sent home. The answer comes from the real
 * store (ADR-0033), which the boot sequence has already hydrated by the time
 * any guard runs — that ordering is what `SessionProvider`'s loading gate
 * exists to guarantee.
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
   * Both from the route, on the `route-meta` channel (ADR-0054 §5, §7): the
   * shell reads what the screen declares about itself, so no layout holds a
   * table of which path says what. The fallback is a key rather than a sentence
   * because it is copy someone reads whenever a route declares nothing.
   */
  const title = useRouteTitle("auth:title");
  const description = useRouteDescription();

  return (
    <AuthLayout description={description} title={title}>
      <Outlet />
    </AuthLayout>
  );
}
