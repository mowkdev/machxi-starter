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
 * The sidebar item and the account menu still point here until `D11.10`
 * retires the one and re-aims the other; both arrive at the same place through
 * this line.
 */
export const Route = createFileRoute("/_dashboard/profile")({
  beforeLoad: () => {
    throw redirect({ to: "/account/profile" });
  },
});
