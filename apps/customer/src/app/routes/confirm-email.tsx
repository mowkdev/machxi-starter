import { createFileRoute } from "@tanstack/react-router";

import { ConfirmEmailPage } from "@/pages/confirm-email";

/**
 * `/confirm-email` — where an address change's link lands (ADR-0071 §6). A
 * route file is wiring (ADR-0049): a path and the page it mounts.
 *
 * **The address is the API's**: the templates build
 * `${CUSTOMER_APP_URL}/confirm-email#token=…` (`MAIL_LINK_PATHS`), so renaming
 * this route turns every link already in a mailbox into a not-found.
 *
 * **The fourth address in this app under neither layout route**, and the page
 * says which guard would break it in which direction. The short of it: this
 * link is mailed to the address the account is moving *to*, so it is opened by
 * a browser that has usually never signed in — and sometimes by one signed in
 * as somebody else entirely.
 *
 * **No `validateSearch`, because nothing arrives in the search string.** The
 * token travels in the URL *fragment*, which no server log and no `Referer`
 * header ever sees (ADR-0071 §1), and which the router hands the page as
 * `location.hash` rather than as validated params.
 */
export const Route = createFileRoute("/confirm-email")({
  component: ConfirmEmailPage,
  /*
   * The heading travels the `route-meta` channel like every other titled route
   * in this app (ADR-0054 §5, §7), even though this page draws its own shell:
   * `staticData` is per route and `useRouteTitle` reads the matched chain.
   */
  staticData: { title: "auth:confirmEmail.title" },
});
