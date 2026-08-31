import { createFileRoute } from "@tanstack/react-router";

import { HomePage } from "@/pages/home";

/**
 * `/`, the signed-in landing screen. A route file is wiring (ADR-0049): a path,
 * the page it mounts, and the copy the shell heads it with.
 *
 * It exists at `D12.2` because the guards need somewhere to land — `_auth`'s
 * mirror guard sends a signed-in visitor here, and the login feature spends the
 * `redirect` the `_dashboard` guard recorded, defaulting to this. `D12.5` gives
 * the page its body; the address is what this step needs.
 */
export const Route = createFileRoute("/_dashboard/")({
  component: HomePage,
  staticData: { title: "home:title" },
});
