import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/account` lands on the first section (ADR-0053 §1).
 *
 * `beforeLoad` rather than a component that redirects on mount: the area has
 * no landing screen of its own, so the operator should never see the frame
 * with an empty content pane while an effect decides where to send them.
 *
 * It declares no `title` either, and for the same reason: a route that throws
 * before it renders has no screen to name, so a title here would put a crumb
 * and an `<h1>` on the trail for a frame nobody ever sees. It is also the one
 * route that would collide if it did — a layout route and its index child
 * share a pathname, which is why `RouteCrumb` keys on the match id rather than
 * on the target (`shared/lib/route-meta`).
 */
export const Route = createFileRoute("/_dashboard/account/")({
  beforeLoad: () => {
    throw redirect({ to: "/account/profile" });
  },
});
