import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";

import { AccountMenu, AppSidebar } from "@/widgets/app-sidebar";
import { DashboardLayout } from "@/widgets/dashboard-layout";

import { useRecordNavigation } from "@/shared/grid/record-navigation";
import { usePseudoNotice, useT } from "@/shared/i18n";
import {
  useRouteCrumbs,
  useRouteFullHeight,
  useRouteRecordLabel,
  useRouteTitle,
} from "@/shared/lib/route-meta";
import {
  Banner,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/shared/ui";

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
 * its heading cannot drift apart. `fullHeight` rides the same channel (`D4.1`,
 * ADR-0037): whether a page is a height budget or a document is a property of
 * the page, and the shell should not hold a list of which paths are grids.
 *
 * **This file composes the two sibling widgets** (`D8.5`, ADR-0049
 * §The-shell-adapter). `AppSidebar` and `AccountMenu` are both `app-sidebar`'s;
 * `dashboard-layout` is a frame that places them and imports neither. `app` is
 * the one layer that may see both slices, and it already did the job for
 * `sidebar` — the account menu travels the same way for the same reason.
 *
 * **And it resolves the route meta, including the two channels `D8.6` added.**
 * The adapter places what it is handed; deciding what to hand it is wiring,
 * which is this file's job.
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
 * The trail, as JSX rather than as data (ADR-0048 §2).
 *
 * A shell that took crumb labels and hrefs would emit plain anchors — a full
 * document reload under TanStack Router — and would be a shell that knows
 * about routing, which is the thing §2 opens by ruling out. So the app
 * composes `Breadcrumb*` from its own door with `asChild` over the typed
 * `Link`, and hands the finished trail in.
 *
 * The last crumb is the current page and is a `BreadcrumbPage`, not a link:
 * it carries `aria-current="page"` and nothing to click. Where the route
 * declares a `recordLabel` the loaded record's own label replaces the route
 * title there — which is why an edit route reads ".../ada@example.com" rather
 * than ".../Edit staff member".
 *
 * `BreadcrumbEllipsis` is deliberately not among the symbols `shared/ui`
 * exports: this trail never collapses, so the seventh export is owed by the
 * first trail that does.
 */
function RouteBreadcrumbs() {
  const crumbs = useRouteCrumbs();
  const recordLabel = useRouteRecordLabel();
  /*
   * The same way back the record surface's own Close uses (ADR-0044). A
   * record URL carries only the record and the list state travels as history
   * state, so a crumb that navigated to `/staff` bare would drop the page,
   * the filters and the sort — and disagree with the Close button in the very
   * dialog it sits behind. Off a record route the carrier is `{}`, so this is
   * a no-op everywhere else.
   */
  const { closeSearch } = useRecordNavigation();

  /*
   * **A trail needs an ancestor, or it is not a trail.** With one crumb it
   * says exactly what the shell's `<h1>` already says, one line above it —
   * that is the reason, and it holds on every route.
   *
   * It also removed an ambiguity, which is how it was found: shadcn's
   * `BreadcrumbPage` is a `<span>` carrying `role="link" aria-disabled="true"`,
   * so a lone "Dashboard" crumb was a second `role="link"` named "Dashboard"
   * beside the sidebar's nav item. **That duplication is not gone in general**
   * — on `/staff/$staffId` the "Staff" ancestor crumb and the sidebar's
   * "Staff" nav link are still two links with one name — so a test reaching
   * for a crumb scopes to this `<nav>` rather than to the document.
   */
  if (crumbs.length < 2) {
    return null;
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;

          /*
           * The separator is a **sibling** of the item, not a child of it:
           * `BreadcrumbItem` and `BreadcrumbSeparator` are both `<li>`, so
           * nesting one inside the other is invalid list markup and React says
           * so at runtime. The fragment keys on the crumb because the pair is
           * one logical entry.
           */
          return (
            <Fragment key={crumb.id}>
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{recordLabel ?? crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link search={closeSearch} to={crumb.to}>
                      {crumb.label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {isLast ? null : <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/**
 * The dev-only pseudo-locale notice, and the banner slot's proving consumer
 * (`D8.7`, ADR-0048 §3).
 *
 * **A hook returning a node or `undefined`, not a component returning
 * `null`** — and the difference is the whole contract. `AppShell` renders its
 * banner region only when the slot is filled, and it decides that by the
 * truthiness of what it was handed: `<PseudoLocaleNotice />` is a truthy
 * element whatever the component then returns, so a component form would have
 * given the shell an empty `div` on every screen with the notice off. The
 * emptiness has to be visible to the *caller*, which means the decision
 * happens before the JSX exists. Found by the test that asserts the region
 * leaves no node.
 *
 * The copy is the **app's**, keyed in the admin's own catalogues rather than
 * the design system's: `Banner` takes a `message` and knows nothing about why
 * it is showing, which is the boundary that lets the same component carry
 * D13's impersonation warning.
 *
 * **Not dismissible.** The open item `D8.2` left for this step is settled by
 * what the notice is *for*: it says the build in front of the operator is not
 * a production one, and a warning about the whole session that can be waved
 * away stops being true after the first click. Nothing here would hold the
 * dismissed state anyway — the notice's provider is the obvious owner, and it
 * has nothing else to own.
 */
const usePseudoLocaleNotice = (): ReactNode => {
  const enabled = usePseudoNotice();
  const { t } = useT("common");

  return enabled ? (
    <Banner message={t("dev.pseudoNotice")} variant="info" />
  ) : undefined;
};

/**
 * The router's own answer to "is a navigation in flight?" (`D10.1`,
 * ADR-0052 §Felt navigation).
 *
 * **The app computes it and the shell renders it**, which is the same division
 * `fullHeight` runs on and the reason `AppShell` can stay routing-ignorant
 * (ADR-0047): a composition that called `useRouterState` would make
 * `@tanstack/react-router` a dependency of the design system, and `apps/web`
 * compiles that package too.
 *
 * The `select` form rather than `useRouterState().status`: the hook re-renders
 * this subtree on **every** router-state change without it — a resolved
 * location, a pending matches array, a preload — and this component sits above
 * the whole app. Selected down to a boolean, the shell re-renders exactly
 * twice per navigation, which is the number of states it has.
 *
 * `status` is `"pending"` from the moment a navigation starts until its
 * matches resolve, which is precisely the window ADR-0052 diagnosed as feeling
 * dead: the router keeps the old screen on purpose (ADR-0052 rejected a
 * pending component for that reason), so without this the click has no answer
 * at all.
 */
const useNavigating = (): boolean =>
  useRouterState({ select: (state) => state.status === "pending" });

function DashboardShell() {
  const banner = usePseudoLocaleNotice();
  const navigating = useNavigating();
  const fullHeight = useRouteFullHeight();
  const routeTitle = useRouteTitle("dashboard:shellFallback");
  const recordLabel = useRouteRecordLabel();

  return (
    <DashboardLayout
      banner={banner}
      breadcrumbs={<RouteBreadcrumbs />}
      sidebar={<AppSidebar />}
      headerEnd={<AccountMenu />}
      /*
       * The record's own label where the record renders as a page, the route
       * title everywhere else (ADR-0048 §2).
       *
       * **No fourth `staticData` field decides this**: the record routes
       * already declare `fullHeight: editSurfaceOf(config) !== "page"`, so on
       * a record route `fullHeight === false` *is* the `page` surface. The
       * branch runs for every route, not only record ones, which is a no-op
       * wherever no `recordLabel` is declared — `/profile` included, and that
       * no-op is worth asserting precisely because it is one.
       *
       * Under `dialog` and `drawer` the shell is behind a modal and keeps the
       * route title, so no shipped screen changes its heading today.
       */
      title={fullHeight ? routeTitle : (recordLabel ?? routeTitle)}
      fullHeight={fullHeight}
      navigating={navigating}
    >
      <Outlet />
    </DashboardLayout>
  );
}
