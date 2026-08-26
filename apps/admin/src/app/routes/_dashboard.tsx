import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
} from "@tanstack/react-router";
import { Fragment } from "react";

import { AccountMenu, AppSidebar } from "@/widgets/app-sidebar";
import { DashboardLayout } from "@/widgets/dashboard-layout";

import { useRecordNavigation } from "@/shared/grid/record-navigation";
import {
  useRouteCrumbs,
  useRouteFullHeight,
  useRouteRecordLabel,
  useRouteTitle,
} from "@/shared/lib/route-meta";
import {
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

function DashboardShell() {
  const fullHeight = useRouteFullHeight();
  const routeTitle = useRouteTitle("dashboard:shellFallback");
  const recordLabel = useRouteRecordLabel();

  return (
    <DashboardLayout
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
    >
      <Outlet />
    </DashboardLayout>
  );
}
