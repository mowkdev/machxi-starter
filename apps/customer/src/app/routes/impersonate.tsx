import { createFileRoute } from "@tanstack/react-router";

import { ImpersonatePage } from "@/pages/impersonate";

/**
 * `/impersonate` — where the admin panel's Impersonate action lands (`D13.7`,
 * ADR-0057 §7). A route file is wiring (ADR-0049): a path and the page it
 * mounts.
 *
 * **The only address in this app that sits under neither layout route, and
 * both omissions are decisions.**
 *
 * It is not under `_dashboard`, because the whole point of the screen is that
 * there is no session yet — the guard would bounce it to `/login` before the
 * exchange could run, carrying `redirect=/impersonate` and the fragment
 * nowhere, since a fragment never reaches a route's search params.
 *
 * It is not under `_auth` either, and that is the less obvious half. That
 * layout's mirror guard sends an *authenticated* visitor home, and an operator
 * arriving here may well be authenticated: ADR-0057 §3 has this browser
 * holding a real customer session and decides that the exchange overwrites its
 * cookies and leaves its row alive. Under the mirror guard that operator would
 * be redirected to somebody else's account instead of into the one they were
 * sent to open. So the page wears the auth shell itself.
 *
 * **No `validateSearch`, because nothing arrives in the search string.** The
 * handoff travels in the URL *fragment*, which no server log and no `Referer`
 * header ever sees (ADR-0057 §2) — and which the router hands the page as
 * `location.hash` rather than as validated params. The fence the login route
 * puts around `redirect` has no analogue here: the value is not a location and
 * is never navigated to; it is posted to one endpoint that answers `401` to
 * everything it does not recognise.
 */
export const Route = createFileRoute("/impersonate")({
  component: ImpersonatePage,
  /*
   * The heading travels the `route-meta` channel like every other titled route
   * in this app (ADR-0054 §5, §7), even though this page draws its own shell:
   * `staticData` is per route and `useRouteTitle` reads the matched chain, so
   * which layout a route sits under has nothing to do with it. The first
   * version of this file skipped the channel and gave the two facts as one
   * reason, which they are not (`D13.7`'s review). No `description`: the card
   * says the whole of what there is to say, and a lede above it would be the
   * same sentence twice.
   */
  staticData: { title: "impersonation:exchange.title" },
});
