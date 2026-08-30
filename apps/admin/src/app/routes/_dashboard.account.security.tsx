import { createFileRoute } from "@tanstack/react-router";

import { AccountSecuritySection } from "@/pages/account";

/** `/account/security` — how you prove it is you (ADR-0053 §1). */
export const Route = createFileRoute("/_dashboard/account/security")({
  component: AccountSecuritySection,
  staticData: { title: "account:sections.security" },
});
