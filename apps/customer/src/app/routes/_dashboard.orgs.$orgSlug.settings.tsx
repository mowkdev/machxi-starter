import { Outlet, createFileRoute } from "@tanstack/react-router";

import { OrganizationSettingsPage } from "@/pages/organization";

/**
 * `/orgs/$orgSlug/settings` — the area's layout route (`D15.9`, ADR-0067 §6 as
 * amended 2026-09-07).
 *
 * A **layout** route now, where `D15.5` had a single screen carrying five cards.
 * The amendment makes a team's settings an area on ADR-0053 §4's composition —
 * the same one `/account` uses, which that record named as its second consumer —
 * so the frame is here and the three sections are its children.
 *
 * Under `_dashboard`, so the guard is inherited rather than remembered
 * (ADR-0049 §Layout topology). The `<Outlet />` is here rather than in
 * `pages/organization` because a route file is wiring and a page is composition
 * (ADR-0049).
 *
 * It declares a `title`, which the shell's page-header band reads (ADR-0054 §5),
 * and each section declares its own.
 */
export const Route = createFileRoute("/_dashboard/orgs/$orgSlug/settings")({
  component: OrganizationSettingsRoute,
  staticData: { title: "organizations:settings.routeTitle" },
});

function OrganizationSettingsRoute() {
  return (
    <OrganizationSettingsPage>
      <Outlet />
    </OrganizationSettingsPage>
  );
}
