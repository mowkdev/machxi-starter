import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/profile` is where the account used to live (ADR-0053 §1).
 *
 * The screen moved to `/account/profile` and the address stays behind as a
 * redirect, so nothing bookmarked breaks — which is the whole reason the
 * record names it. It keeps no `title` and no component: it renders nothing,
 * so a crumb or a heading from it would describe a screen the operator never
 * sees.
 *
 * **Nothing in the app points here since `D11.10`** — the sidebar item retired
 * (ADR-0053 §3) and the account menu now names the area rather than a section
 * — which is exactly the state a redirect for bookmarks should be in: it
 * exists for addresses the app no longer produces. That also makes it the one
 * route whose only reader is outside the codebase, so the routing suite is
 * where it stays honest.
 */
export const Route = createFileRoute("/_dashboard/profile")({
  beforeLoad: () => {
    throw redirect({ to: "/account/profile" });
  },
});
