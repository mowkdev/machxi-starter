import { createFileRoute } from "@tanstack/react-router";

import { OrganizationGeneralSection } from "@/pages/organization";

/** `/orgs/$orgSlug/settings/general` — name, address and deletion (ADR-0067 §6, §7). */
export const Route = createFileRoute(
  "/_dashboard/orgs/$orgSlug/settings/general",
)({
  component: OrganizationGeneralSection,
  staticData: { title: "organizations:settings.sections.general" },
});
