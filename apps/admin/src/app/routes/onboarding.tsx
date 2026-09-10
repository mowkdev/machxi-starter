import { createFileRoute } from "@tanstack/react-router";

import { OnboardingPage } from "@/pages/onboarding";

/**
 * `/onboarding` — where an invited operator's link lands (ADR-0071 §8). A
 * route file is wiring (ADR-0032): a path and the page it mounts.
 *
 * **The address is the API's**: the templates build
 * `${ADMIN_APP_URL}/onboarding#token=…` (`MAIL_LINK_PATHS`), so renaming this
 * route turns every invitation already in a mailbox into a not-found.
 *
 * **The second address in this app under neither layout route** — see the page
 * for which guard would break it in which direction.
 *
 * **No `validateSearch`, because nothing arrives in the search string.** The
 * token travels in the URL *fragment*, which no server log and no `Referer`
 * header ever sees (ADR-0071 §1), and which the router hands the page as
 * `location.hash` rather than as validated params.
 */
export const Route = createFileRoute("/onboarding")({
  component: OnboardingPage,
  /*
   * The heading travels the `route-meta` channel like every other titled route
   * in this app (ADR-0054 §5, §7), even though this page draws its own shell:
   * `staticData` is per route and `useRouteTitle` reads the matched chain.
   */
  staticData: { title: "auth:onboarding.title" },
});
