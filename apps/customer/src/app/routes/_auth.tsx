import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AuthLayout } from "@/widgets/auth-layout";

import { useRouteDescription, useRouteTitle } from "@/shared/lib/route-meta";

/**
 * The unauthenticated half of ADR-0049 §Layout topology — a pathless layout
 * route, so `/login` renders inside the auth shell without `login` appearing
 * twice in the URL.
 *
 * **The mirror guard is `D12.2`'s.** In the admin this route's `beforeLoad`
 * turns a signed-in operator away from the login screen, and it can only read a
 * session store that does not exist here yet. The topology it guards is what
 * this step builds; the guard lands on it in one `beforeLoad` when the store
 * does.
 */
export const Route = createFileRoute("/_auth")({
  component: AuthShell,
});

function AuthShell() {
  /*
   * Both from the route, on the `route-meta` channel (ADR-0054 §5, §7): the
   * shell reads what the screen declares about itself, so no layout holds a
   * table of which path says what. The fallback is a key rather than a sentence
   * because it is copy an operator reads whenever a route declares nothing.
   */
  const title = useRouteTitle("auth:title");
  const description = useRouteDescription();

  return (
    <AuthLayout description={description} title={title}>
      <Outlet />
    </AuthLayout>
  );
}
