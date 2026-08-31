import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/account` lands on the first section (`D12.6`, ADR-0053 §1).
 *
 * `beforeLoad` rather than a component that redirects on mount: the area has no
 * landing screen of its own, so a customer should never see the frame with an
 * empty content pane while an effect decides where to send them.
 *
 * **This is also what makes the account control's link honest.** That menu
 * entry names the *area* rather than a section, so a fourth section later costs
 * nothing there; this file is the other half of that arrangement.
 *
 * It declares no `title`, and for the same reason it redirects: a route that
 * throws before it renders has no screen to name, so a title here would put a
 * heading on a frame nobody ever sees.
 */
export const Route = createFileRoute("/_dashboard/account/")({
  beforeLoad: () => {
    throw redirect({ to: "/account/profile" });
  },
});
