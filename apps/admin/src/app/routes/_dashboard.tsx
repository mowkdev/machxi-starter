import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { AppSidebar } from "@/widgets/app-sidebar";
import { DashboardLayout } from "@/widgets/dashboard-layout";

import { useRouteTitle } from "@/shared/lib/route-title";

/**
 * The guard, and the reason it lives here (ADR-0032 §Layout topology).
 *
 * A `<RequireAuth>` wrapper is a guard every new page has to remember — the
 * per-route-auth mistake ADR-0015 rejected on the API. Putting it on a pathless
 * layout route makes protection structural instead: adding a page under
 * `_dashboard/` inherits it, and mounting a protected page outside it is not a
 * review catch but a visible new layout route.
 *
 * `redirect` carries the attempted location so a session that expires mid-task
 * returns the operator to the screen they were on; the login route validates it
 * as a same-origin path, so it cannot become an open redirect. Since `D3.4` the
 * predicate is the real store: the access token's presence *is* the
 * authenticated state (ADR-0033), and the API client invalidating the router
 * when a session dies is what re-runs this guard mid-session.
 *
 * The title is per-route `staticData` rather than a lookup table, so a page and
 * its heading cannot drift apart.
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
  return (
    <DashboardLayout sidebar={<AppSidebar />} title={useRouteTitle("Admin")}>
      <Outlet />
    </DashboardLayout>
  );
}
