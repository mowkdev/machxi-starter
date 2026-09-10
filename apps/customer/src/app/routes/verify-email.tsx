import { createFileRoute } from "@tanstack/react-router";

import { VerifyEmailPage } from "@/pages/verify-email";

/**
 * `/verify-email` — where a sign-up lands and where the mailed confirmation
 * link lands (ADR-0071 §3). A route file is wiring (ADR-0049): a path and the
 * page it mounts.
 *
 * **The address is the API's, not this app's to choose.** The templates build
 * `${CUSTOMER_APP_URL}/verify-email#token=…` (`MAIL_LINK_PATHS`), so renaming
 * this route turns every link already in somebody's mailbox into a not-found.
 *
 * **The second address in this app that sits under neither layout route, and
 * both omissions are `/impersonate`'s.**
 *
 * It is not under `_dashboard`, because most arrivals have no session yet —
 * that guard would bounce them to `/login` carrying `redirect=/verify-email`
 * and the fragment nowhere, since a fragment never reaches a route's search
 * params.
 *
 * It is not under `_auth` either. That layout's mirror guard sends an
 * *authenticated* visitor home, and somebody confirming a second account, or
 * using a shared machine, arrives here with a live session — which is the
 * ordinary case rather than the exotic one, since the link is followed
 * wherever the mail is read. Under the mirror guard the exchange would be
 * redirected away before it could run. So the page wears the auth shell
 * itself.
 *
 * **It is not behind `FEATURE_USER_REGISTRATION` either**, and that mirrors
 * the API: `createVerificationRouter` is mounted unconditionally beside the
 * flagged `createRegisterRouter`, because an address can reach
 * `pending_verification` without self-registration — a staff member may create
 * one — and a deployment that closes sign-ups after somebody has signed up
 * must not turn the link in their mailbox into a not-found.
 *
 * **No `validateSearch`, because nothing arrives in the search string.** The
 * token travels in the URL *fragment*, which no server log and no `Referer`
 * header ever sees (ADR-0071 §1), and which the router hands the page as
 * `location.hash` rather than as validated params. The address the resend
 * control starts with travels as history state, not as a param — see
 * `features/auth/verify-email/awaited-address.ts` for why.
 */
export const Route = createFileRoute("/verify-email")({
  component: VerifyEmailPage,
  /*
   * The heading travels the `route-meta` channel like every other titled route
   * in this app (ADR-0054 §5, §7), even though this page draws its own shell:
   * `staticData` is per route and `useRouteTitle` reads the matched chain. No
   * `description`: the card says the whole of what there is to say, and a lede
   * above it would be the same sentence twice.
   */
  staticData: { title: "auth:verify.title" },
});
