import { createFileRoute } from "@tanstack/react-router";

import { OrganizationInvitationsSectionPage } from "@/pages/organization";

/** `/orgs/$orgSlug/settings/invitations` — the offers waiting (ADR-0067 §2). */
export const Route = createFileRoute(
  "/_dashboard/orgs/$orgSlug/settings/invitations",
)({
  component: OrganizationInvitationsSectionPage,
  staticData: { title: "organizations:settings.sections.invitations" },
});
