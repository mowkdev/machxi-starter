import { createFileRoute } from "@tanstack/react-router";

import { AcceptInvitationPage } from "@/pages/accept-invitation";

/**
 * `/invitations/accept` — where the mailed invitation link lands
 * (ADR-0071 §5). A route file is wiring (ADR-0049): a path and the page it
 * mounts.
 *
 * **The address is the API's, not this app's to choose.** The templates build
 * `${CUSTOMER_APP_URL}/invitations/accept#token=…` (`MAIL_LINK_PATHS`), so
 * renaming this route turns every invitation already in a mailbox into a
 * not-found.
 *
 * **The fourth address in this app that sits under neither layout route**,
 * after `/impersonate`, `/verify-email` and `/reset-password` — and the one
 * that needs both omissions at once rather than one of them. `_auth`'s mirror
 * guard sends an *authenticated* visitor home, and an authenticated visitor is
 * precisely who can accept an invitation; `_dashboard`'s guard sends an
 * anonymous one to `/login`, and an anonymous one is precisely who the
 * register form on this screen is for. Either guard would break the flow for
 * half of its readers, and the redirect would take the fragment with it, since
 * a fragment never reaches a route's search params.
 *
 * **Not `/account/invitations`, which is the other half of the flow.** That
 * one lists the offers made to the address the caller is signed in with and
 * lives inside the account area behind the guard (ADR-0067 §4); this one is
 * reached by whoever opened the mail, who may have no account at all.
 *
 * **No `validateSearch`, because nothing arrives in the search string.** The
 * token travels in the URL *fragment*, which no server log and no `Referer`
 * header ever sees (ADR-0071 §1), and which the router hands the page as
 * `location.hash` rather than as validated params.
 */
export const Route = createFileRoute("/invitations/accept")({
  component: AcceptInvitationPage,
  /*
   * The heading travels the `route-meta` channel like every other titled route
   * in this app (ADR-0054 §5, §7), even though this page draws its own shell:
   * `staticData` is per route and `useRouteTitle` reads the matched chain. No
   * `description`: the card says the whole of what there is to say, and the
   * sentence a reader needs differs by which of the three landings they are
   * on — a lede fixed on the route could only be true for one of them.
   */
  staticData: { title: "organizations:link.title" },
});
