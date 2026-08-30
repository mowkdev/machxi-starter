import { createFileRoute } from "@tanstack/react-router";

/**
 * `/account/preferences` — how the app behaves for you (ADR-0053 §1).
 *
 * **The address exists before its contents do, and that is the plan's own
 * division**: `D11.9` builds the route family and `D11.10` moves the theme,
 * density and locale controls into this section from the account menu. Until
 * it does, the route is a title and a crumb over an empty content pane — the
 * honest intermediate state, rather than a placeholder card carrying copy that
 * the next step would delete.
 *
 * No `component`: TanStack's default renders an `<Outlet />`, which for a leaf
 * is nothing. `D11.10` adds one.
 */
export const Route = createFileRoute("/_dashboard/account/preferences")({
  staticData: { title: "account:sections.preferences" },
});
