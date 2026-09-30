import { OnboardingForm } from "@/features/auth";

import { useRouteTitle } from "@/shared/lib/route-meta";
import { AuthLayout } from "@/shared/ui";

/**
 * `/onboarding` — where an invited operator's link lands (ADR-0071 §8).
 *
 * **The address is the API's, not this app's to choose.** The templates build
 * `${ADMIN_APP_URL}/onboarding#token=…` (`MAIL_LINK_PATHS`), so renaming this
 * route turns every invitation already in somebody's mailbox into a
 * not-found.
 *
 * **The second address in this app under neither layout route**, and it has
 * to be for `/reset-password`'s reasons in both directions. `_auth`'s guard
 * sends an *authenticated* visitor home, and an invitation is opened wherever
 * the mail is read — including on a machine where a colleague is still signed
 * in; under that guard the screen would be redirected away before it could do
 * anything. `_dashboard` is wrong the other way: every arrival here has no
 * session by definition — the account has never had a password — and its
 * guard would bounce them to `/login` with the fragment nowhere, since a
 * fragment never reaches a route's search params.
 *
 * **No lede under the heading**: this screen has two states and one of them is
 * a dead link, so a sentence fixed on the route would be an instruction to
 * choose a password printed above a notice explaining there is nothing to choose
 * one for. The card says the whole of what there is to say.
 *
 * A page is thin composition (ADR-0049): the feature owns the link, the form
 * and both states, and this is the shell around them, whose one card holds
 * the heading and the form alike (ADR-0080 §3).
 */
export const OnboardingPage = () => {
  /*
   * The fallback is the key the route declares, which is `_auth.tsx`'s shape
   * too: the hook's parameter is required, and a screen that is its own shell
   * always matches a route that declares one, so the fallback is unreachable
   * here rather than a second place the copy lives.
   */
  const title = useRouteTitle("auth:onboarding.title");

  return (
    <AuthLayout description={undefined} title={title}>
      <OnboardingForm />
    </AuthLayout>
  );
};
