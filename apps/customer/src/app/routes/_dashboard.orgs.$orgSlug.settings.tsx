import { createFileRoute } from "@tanstack/react-router";

import { OrganizationSettingsPage } from "@/pages/organization";

/**
 * `/orgs/$orgSlug/settings` — name and address, members, invitations, a new
 * organization and deletion (`D15.5`, ADR-0067 §6, §7).
 *
 * A sibling of the overview rather than a child of a layout route, because
 * there is no chrome the two share: each resolves the same slug out of the same
 * cached list, which costs a `find` over a handful of rows and buys the two
 * screens their independence. A layout route would exist only to hold a
 * resolution that is already a one-line hook.
 */
export const Route = createFileRoute("/_dashboard/orgs/$orgSlug/settings")({
  component: OrganizationSettingsRoute,
  staticData: { title: "organizations:settings.routeTitle" },
});

function OrganizationSettingsRoute() {
  const { orgSlug } = Route.useParams();

  return <OrganizationSettingsPage slug={orgSlug} />;
}
