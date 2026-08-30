import { createFileRoute } from "@tanstack/react-router";

import { AccountProfileSection } from "@/pages/account";

/** `/account/profile` — who you are (ADR-0053 §1). */
export const Route = createFileRoute("/_dashboard/account/profile")({
  component: AccountProfileSection,
  staticData: { title: "account:sections.profile" },
});
