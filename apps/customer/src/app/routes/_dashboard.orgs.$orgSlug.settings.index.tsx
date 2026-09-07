import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/orgs/$orgSlug/settings` lands on the first section (`D15.9`), which is the
 * arrangement `/account` already has (ADR-0053 §1).
 *
 * `beforeLoad` rather than a component that redirects on mount: the area has no
 * landing screen of its own, so nobody should see the frame with an empty
 * content pane while an effect decides where to send them.
 *
 * **It is also what makes the switcher's menu entry honest.** That entry names
 * the area rather than a section, so a fourth section later costs nothing there.
 *
 * It declares no `title`, and for the same reason it redirects: a route that
 * throws before it renders has no screen to name.
 *
 * `params` is threaded through explicitly — a redirect inside a parameterised
 * subtree does not inherit the match's params, and a `to` without them would not
 * type-check against the generated tree.
 */
export const Route = createFileRoute("/_dashboard/orgs/$orgSlug/settings/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      params: { orgSlug: params.orgSlug },
      to: "/orgs/$orgSlug/settings/general",
    });
  },
});
