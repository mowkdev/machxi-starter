import { createFileRoute } from "@tanstack/react-router";

import { AccountPreferencesSection } from "@/pages/account";

/**
 * `/account/preferences` — how the app behaves for you (ADR-0053 §1).
 *
 * **`D11.9` shipped this as a title with no component and `D11.10` gave it
 * one**, which is the plan's own division: the address existed before its
 * contents did rather than carrying a placeholder card written to be deleted.
 * It now holds the appearance, density and language cards that ADR-0053 §2
 * took out of the account menu.
 */
export const Route = createFileRoute("/_dashboard/account/preferences")({
  component: AccountPreferencesSection,
  staticData: { title: "account:sections.preferences" },
});
