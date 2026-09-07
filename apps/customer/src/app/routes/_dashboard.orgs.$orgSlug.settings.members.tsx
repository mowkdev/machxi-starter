import { createFileRoute } from "@tanstack/react-router";

import { OrganizationMembersSectionPage } from "@/pages/organization";

/** `/orgs/$orgSlug/settings/members` — who belongs here, and as what (ADR-0067 §2). */
export const Route = createFileRoute(
  "/_dashboard/orgs/$orgSlug/settings/members",
)({
  component: OrganizationMembersSectionPage,
  staticData: { title: "organizations:settings.sections.members" },
});
