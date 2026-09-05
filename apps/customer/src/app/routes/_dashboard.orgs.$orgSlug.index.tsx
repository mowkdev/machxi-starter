import { createFileRoute } from "@tanstack/react-router";

import { OrganizationOverviewPage } from "@/pages/organization";

/**
 * `/orgs/$orgSlug` — one organization, addressed the way the API addresses it
 * (`D15.5`, ADR-0067 §6).
 *
 * Under `_dashboard`, so the guard is inherited rather than remembered
 * (ADR-0049 §Layout topology): an organization screen is as protected as every
 * other because of where this file sits.
 *
 * **The slug, not the id**, mirroring the API so a customer URL and an API path
 * say the same thing — and a slug is what a person can read back off the
 * address bar. The translation into the id the API wants happens once, in the
 * page, against the switcher's list.
 *
 * There is deliberately **no loader**: resolving the slug is a cache read, not
 * a fetch, and a loader would turn "you are not in that organization" into a
 * round trip whose timing says whether the organization exists.
 */
export const Route = createFileRoute("/_dashboard/orgs/$orgSlug/")({
  component: OrganizationOverviewRoute,
  staticData: { title: "organizations:overview.routeTitle" },
});

function OrganizationOverviewRoute() {
  const { orgSlug } = Route.useParams();

  return <OrganizationOverviewPage slug={orgSlug} />;
}
