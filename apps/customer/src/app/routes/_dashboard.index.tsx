import { createFileRoute } from "@tanstack/react-router";

import { HomePage } from "@/pages/home";

/**
 * `/`, the signed-in landing screen. A route file is wiring (ADR-0049): a path,
 * the page it mounts, and the copy the shell heads it with.
 *
 * It exists at `D12.2` because the guards need somewhere to land — `_auth`'s
 * mirror guard sends a signed-in visitor here, and the login feature spends the
 * `redirect` the `_dashboard` guard recorded, defaulting to this. `D12.5` gave
 * the page its body and moved its heading into the shell's page-header band;
 * `title` is what the band reads, and it has not moved from this line.
 *
 * **No `description`.** ADR-0054 §5's band draws one under the title where a
 * route declares one, and this screen's single sentence is its body rather than
 * a subtitle over an empty page — so nothing in this app hands the shell a
 * description yet, and `widgets/dashboard-layout` does not carry the prop until
 * something does.
 */
export const Route = createFileRoute("/_dashboard/")({
  component: HomePage,
  staticData: { title: "home:title" },
});
