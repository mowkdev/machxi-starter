import { ResetPasswordForm } from "@/features/auth";

import { useRouteTitle } from "@/shared/lib/route-meta";
import { AuthLayout, Card } from "@/shared/ui";

/**
 * `/reset-password` — where the recovery link lands (ADR-0071 §4).
 *
 * **The address is the API's, not this app's to choose.** The templates build
 * `${CUSTOMER_APP_URL}/reset-password#token=…` (`MAIL_LINK_PATHS`), so renaming
 * this route turns every link already in somebody's mailbox into a not-found.
 *
 * **It composes `AuthLayout` itself rather than sitting under `_auth`**, which
 * is `/verify-email`'s and `/impersonate`'s constraint and not a preference.
 * `_auth`'s guard sends an *authenticated* visitor home, and a link is followed
 * wherever the mail is read — a second account, a shared machine, a household,
 * or simply somebody signed in on this device who cannot remember the password
 * they want to change. Under that guard the screen would be redirected away
 * before it could do anything, spending nothing and explaining nothing.
 * `_dashboard` is wrong in the other direction: most arrivals have no session,
 * and its guard would bounce them to `/login` with the fragment nowhere, since
 * a fragment never reaches a route's search params.
 *
 * **No lede under the heading**, which is `/verify-email`'s omission for
 * `/verify-email`'s reason: this screen has two states and one of them is a
 * dead link, so a sentence fixed on the route would be an instruction to
 * choose a password printed above a card explaining that there is nothing to
 * choose one for. The card says the whole of what there is to say.
 *
 * A page is thin composition (ADR-0049): the feature owns the link, the form
 * and both states, and this is the shell and the card around them.
 */
export const ResetPasswordPage = () => {
  /*
   * The fallback is the key the route declares, which is `_auth.tsx`'s shape
   * too: the hook's parameter is required, and a screen that is its own shell
   * always matches a route that declares one, so the fallback is unreachable
   * here rather than a second place the copy lives.
   */
  const title = useRouteTitle("auth:reset.title");

  return (
    <AuthLayout description={undefined} title={title}>
      <Card className="p-5">
        <ResetPasswordForm />
      </Card>
    </AuthLayout>
  );
};
