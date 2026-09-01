import {
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { AccountMenu, AppSidebar } from "@/widgets/app-sidebar";
import { DashboardLayout } from "@/widgets/dashboard-layout";
import { useImpersonationBanner } from "@/widgets/impersonation-banner";

import { usePseudoNotice, useT } from "@/shared/i18n";
import { useRouteTitle } from "@/shared/lib/route-meta";
import { Banner } from "@/shared/ui";

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
 * The dev-only pseudo-locale notice, and this app's consumer for the shell's
 * `banner` slot (`D12.9`, ADR-0048 §3, ADR-0046 §10).
 *
 * **A hook returning a node or `undefined`, not a component returning
 * `null`** — and the difference is the whole contract. `AppShell` renders its
 * banner region only when the slot is filled, and it decides that by the
 * truthiness of what it was handed: `<PseudoLocaleNotice />` is a truthy
 * element whatever the component then returns, so a component form would have
 * given the shell an empty `div` on every screen with the notice off. The
 * emptiness has to be visible to the *caller*, which means the decision happens
 * before the JSX exists.
 *
 * The copy is the **app's**, keyed in this app's own catalogues rather than the
 * design system's: `Banner` takes a `message` and knows nothing about why it is
 * showing, which is the boundary that lets the same component carry D13's
 * impersonation warning. The sentence is not the admin's either — the two apps
 * share the machinery and share none of the words (ADR-0046 §13).
 *
 * **Not dismissible.** The notice says the build in front of the reader is a
 * translation build and not a production one, and a warning about the whole
 * session that can be waved away stops being true after the first click.
 *
 * The flag arrives through `usePseudoNotice` rather than by reading
 * `config.VITE_I18N_PSEUDO` here, and that is what makes this testable at all:
 * `vitest.config.ts` pins the variable to `"false"` for the whole suite on
 * purpose, so a notice gated on it directly would render in no test in this
 * repository. The context has a seam the harness can drive.
 */
const usePseudoLocaleNotice = (): ReactNode => {
  const enabled = usePseudoNotice();
  const { t } = useT("common");

  return enabled ? (
    <Banner message={t("dev.pseudoNotice")} variant="info" />
  ) : undefined;
};

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

/**
 * The shell's `banner` region has two possible fillings since `D13.7`, and one
 * slot to put them in.
 *
 * They are stacked rather than ranked because neither is the other's
 * condition: the pseudo-locale notice says the *build* is a translation build
 * and the impersonation banner says the *session* is somebody else's, and a
 * developer impersonating under the lens needs both sentences — suppressing
 * either would hide a warning to tidy a region.
 *
 * The emptiness still has to be visible to the caller (ADR-0048 §3, amended
 * `D8.7`), so this returns `undefined` when nothing is filled and the node
 * itself when exactly one is — a wrapper around a single banner would put a
 * `div` in the region on every impersonated screen for no reason. Only the
 * genuinely rare case pays for the stack.
 */
const bannerSlot = (
  impersonation: ReactNode,
  pseudoNotice: ReactNode,
): ReactNode => {
  /*
   * `== null` rather than `=== undefined`: a notice hook that ever returned
   * `null` would count as filled, and the shell would draw an empty region on
   * every screen — the exact regression ADR-0048 §3's amended contract exists
   * to prevent, reintroduced one level up from where it was fixed.
   */
  if (impersonation == null) return pseudoNotice ?? undefined;
  if (pseudoNotice == null) return impersonation;

  /*
   * Written out rather than mapped over an array: two nodes rendered from a
   * list would need keys, and inventing keys for a fixed pair is ceremony
   * around a defect the shape avoids. It also keeps the order readable, which
   * is the one thing about the stack that is a decision.
   */
  return (
    <div className="flex flex-col gap-2">
      {impersonation}
      {pseudoNotice}
    </div>
  );
};

function DashboardShell() {
  const impersonation = useImpersonationBanner();
  const pseudoNotice = usePseudoLocaleNotice();
  /*
   * The impersonation warning first, because it is the one a person has to act
   * on and the region reads top to bottom.
   */
  const banner = bannerSlot(impersonation, pseudoNotice);
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
      banner={banner}
      headerEnd={<AccountMenu />}
      navigating={navigating}
      sidebar={<AppSidebar />}
      title={title}
    >
      <Outlet />
    </DashboardLayout>
  );
}
