import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The guard, and the reason it lives here (ADR-0049 §Layout topology).
 *
 * A `<RequireAuth>` wrapper is a guard every new page has to remember — the
 * per-route-auth mistake ADR-0015 rejected on the API. Putting it on a pathless
 * layout route makes protection structural instead: adding a page under
 * `_dashboard/` inherits it, and mounting a protected page outside it is not a
 * review catch but a visible new layout route.
 *
 * `redirect` carries the attempted location so a session that expires mid-task
 * returns someone to the screen they were on; the login route validates it as a
 * same-origin path, so it cannot become an open redirect. The predicate is the
 * real store: the access token's presence *is* the authenticated state
 * (ADR-0033), and the API client invalidating the router when a session dies is
 * what re-runs this guard mid-session.
 *
 * **It renders a bare `Outlet` at `D12.2`, and that is the step boundary.** The
 * admin's equivalent composes `AppShell` and resolves the route meta for it;
 * this app's shell — the sidebar node, the `headerEnd` account control, the
 * version footer — is `D12.5`, and the guard is what `D12.2`'s done-when is
 * about. Splitting them this way is also what lets the guard suite assert the
 * redirect without a shell in the way of the assertion.
 */
export const Route = createFileRoute("/_dashboard")({
  beforeLoad: ({ context, location }) => {
    if (!context.session.isAuthenticated()) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: DashboardShell,
});

function DashboardShell() {
  return <Outlet />;
}
