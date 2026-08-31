import {
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from "@tanstack/react-router";

import { AccountMenu, AppSidebar } from "@/widgets/app-sidebar";
import { DashboardLayout } from "@/widgets/dashboard-layout";

import { useRouteTitle } from "@/shared/lib/route-meta";

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
 * **`D12.5` gave it the shell it was holding a place for.** `D12.2` rendered a
 * bare `Outlet` here on purpose, so its guard suite could assert the redirect
 * with no shell in the way of the assertion; those assertions still stand,
 * because a guard that throws in `beforeLoad` never reaches a component. What
 * this file composes now is what ADR-0049 §The-shell-adapter says the `app`
 * layer is for: `AppSidebar` and `AccountMenu` are both `app-sidebar`'s,
 * `dashboard-layout` is a frame that places them and imports neither, and this
 * is the one layer that may see both.
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

/**
 * The router's own answer to "is a navigation in flight?" (ADR-0052 §Felt
 * navigation, the delta this app inherits with `AppShell`).
 *
 * **The app computes it and the shell renders it**, which is what lets
 * `AppShell` stay routing-ignorant (ADR-0047): a composition that called
 * `useRouterState` would make `@tanstack/react-router` a dependency of the
 * design system.
 *
 * The `select` form rather than `useRouterState().status`: the hook re-renders
 * this subtree on **every** router-state change without it — a resolved
 * location, a pending matches array, a preload — and this component sits above
 * the whole app. Selected down to a boolean, the shell re-renders exactly twice
 * per navigation, which is the number of states it has.
 */
const useNavigating = (): boolean =>
  useRouterState({ select: (state) => state.status === "pending" });

function DashboardShell() {
  const navigating = useNavigating();
  /*
   * The fallback is a key, not a sentence (ADR-0046 §7): it is copy a customer
   * reads whenever a route declares no title of its own. `common:brand.product`
   * is this app's word for itself — the same string the drawer's brand block
   * shows — so an untitled screen is headed "Account" rather than with the
   * admin's "Dashboard", which is the word ADR-0055 §5 says this app does not
   * use.
   */
  const title = useRouteTitle("brand.product");

  return (
    <DashboardLayout
      headerEnd={<AccountMenu />}
      navigating={navigating}
      sidebar={<AppSidebar />}
      title={title}
    >
      <Outlet />
    </DashboardLayout>
  );
}
