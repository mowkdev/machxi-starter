import { createFileRoute } from "@tanstack/react-router";

import { AccountInvitationsSection } from "@/pages/account";

/** `/account/invitations` — who has invited you (`D15.5`, ADR-0053 §1). */
export const Route = createFileRoute("/_dashboard/account/invitations")({
  component: AccountInvitationsSection,
  staticData: { title: "account:sections.invitations" },
});
