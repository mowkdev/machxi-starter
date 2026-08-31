import { createFileRoute } from "@tanstack/react-router";

import { AccountPreferencesSection } from "@/pages/account";

/**
 * `/account/preferences` — how the app behaves for you (`D12.7`, ADR-0053 §1).
 *
 * The third section, and the one ADR-0053 §2's escape-hatch mitigation is
 * really about: a customer stranded in a language they cannot read reaches it
 * through the account control and a section label with a stable icon beside it.
 */
export const Route = createFileRoute("/_dashboard/account/preferences")({
  component: AccountPreferencesSection,
  staticData: { title: "account:sections.preferences" },
});
