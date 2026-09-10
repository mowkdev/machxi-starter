import { createFileRoute } from "@tanstack/react-router";

import { ResetPasswordPage } from "@/pages/reset-password";

/**
 * `/reset-password` — where an operator's mailed recovery link lands (ADR-0071
 * §4). A route file is wiring (ADR-0032): a path and the page it mounts.
 *
 * **The address is the API's**: the templates build
 * `${ADMIN_APP_URL}/reset-password#token=…` for a staff recipient
 * (`MAIL_LINK_PATHS`), so renaming this route turns every link already in a
 * mailbox into a not-found.
 *
 * **The first address in this app under neither layout route** — see the page
 * for which guard would break it in which direction.
 *
 * **No `validateSearch`, because nothing arrives in the search string.** The
 * token travels in the URL *fragment*, which no server log and no `Referer`
 * header ever sees (ADR-0071 §1), and which the router hands the page as
 * `location.hash` rather than as validated params.
 */
export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
  /*
   * The heading travels the `route-meta` channel like every other titled route
   * in this app (ADR-0054 §5, §7), even though this page draws its own shell:
   * `staticData` is per route and `useRouteTitle` reads the matched chain.
   */
  staticData: { title: "auth:reset.title" },
});
