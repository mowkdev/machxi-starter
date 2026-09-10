import { ResetPasswordForm } from "@/features/auth";

import { useRouteTitle } from "@/shared/lib/route-meta";
import { AuthLayout, Card } from "@/shared/ui";

/**
 * `/reset-password` — where an operator's recovery link lands (ADR-0071 §4).
 *
 * **The address is the API's, not this app's to choose.** The templates build
 * `${ADMIN_APP_URL}/reset-password#token=…` for a staff recipient
 * (`MAIL_LINK_PATHS`), so renaming this route turns every link already in
 * somebody's mailbox into a not-found.
 *
 * **The first address in this app that sits under neither layout route**, and
 * it has to be. `_auth`'s guard sends an *authenticated* visitor home, and a
 * link is followed wherever the mail is read — including in a browser where the
 * operator is still signed in and simply cannot remember the password they want
 * to change; under that guard the screen would be redirected away before it
 * could do anything. `_dashboard` is wrong in the other direction: most
 * arrivals have no session, and its guard would bounce them to `/login` with
 * the fragment nowhere, since a fragment never reaches a route's search params.
 *
 * **No lede under the heading**: this screen has two states and one of them is
 * a dead link, so a sentence fixed on the route would be an instruction to
 * choose a password printed above a card explaining there is nothing to choose
 * one for. The card says the whole of what there is to say.
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
