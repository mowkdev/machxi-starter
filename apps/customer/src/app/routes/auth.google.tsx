import { createFileRoute } from "@tanstack/react-router";

import { AuthGooglePage } from "@/pages/auth-google";

/**
 * `/auth/google` — where Google's callback hands a person back to this app
 * (ADR-0072 §2, §4). A route file is wiring (ADR-0049): a path and the page it
 * mounts.
 *
 * **The address is the API's, not this app's to choose.** The callback
 * answers `302` to `${CUSTOMER_APP_URL}/auth/google#…`, so renaming this route
 * turns every sign-in into a not-found.
 *
 * **Under neither layout route**, like `/impersonate` and `/verify-email`,
 * and for their two reasons: not under `_dashboard`, because most arrivals have no session yet
 * and a fragment never survives the guard's redirect; not under `_auth`,
 * because that layout sends a signed-in visitor home, and a person finishing a
 * sign-in in a browser that holds one must be *asked* rather than redirected
 * away (ADR-0071 §3's `D18.4` rule, inherited by ADR-0072 §2).
 *
 * **Not behind `VITE_FEATURE_GOOGLE_SIGN_IN`**, which decides whether the
 * *button* is in the bundle. A callback lands here whenever the API has a
 * Google client, and an arrival that meets a not-found has lost its handoff
 * and its refusal both; the API's mount is the control (§4).
 *
 * **No `validateSearch`, because nothing arrives in the search string.** The
 * callback puts one parameter in the fragment — `token`, `linked` or `error` —
 * which no server log and no `Referer` sees, and which the router hands the
 * page as `location.hash`.
 */
export const Route = createFileRoute("/auth/google")({
  component: AuthGooglePage,
  // The heading, on the `route-meta` channel like every titled route here
  // (ADR-0054 §5, §7), though the page draws its own shell.
  staticData: { title: "auth:google.title" },
});
