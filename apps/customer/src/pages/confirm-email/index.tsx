import { Link } from "@tanstack/react-router";

import { useConfirmEmail, type EmailChangeStatus } from "@/features/auth";

import { useT } from "@/shared/i18n";
import { useRouteTitle } from "@/shared/lib/route-meta";
import { AuthLayout, Card } from "@/shared/ui";

/**
 * The sentence per state, as a table rather than an interpolated key.
 *
 * `/verify-email`'s device, for its reason: a template literal would resolve
 * to the same union today and would stop doing so the moment a state's key
 * stopped matching its name — silently, with i18next returning the key itself.
 * The table is what the compiler checks.
 */
const MESSAGE_KEY = {
  pending: "confirmEmail.pending",
  confirmed: "confirmEmail.confirmed",
  taken: "confirmEmail.taken",
  refused: "confirmEmail.refused",
} as const satisfies Readonly<Record<EmailChangeStatus, string>>;

/**
 * `/confirm-email` — where an address change's link lands (ADR-0071 §6).
 *
 * **The address is the API's, not this app's to choose.** The templates build
 * `${CUSTOMER_APP_URL}/confirm-email#token=…` (`MAIL_LINK_PATHS`), so renaming
 * this route turns every link already in a mailbox into a not-found.
 *
 * **The fourth address in this app that sits under neither layout route**,
 * after `/impersonate`, `/verify-email` and `/reset-password`, and here the
 * constraint is at its sharpest: this link is mailed to the address the
 * account is moving *to*, so the browser that opens it is very often one that
 * has never signed in at all. Under `_dashboard` an anonymous arrival would be
 * bounced to `/login` with the fragment nowhere, since a fragment never
 * reaches a route's search params; under `_auth`'s mirror guard a signed-in
 * arrival — the person who asked for the change, reading the mail on the
 * device they asked from — would be sent home before the exchange could run.
 *
 * **The screen ends on a sentence rather than on a navigation**, which is what
 * separates it from `/verify-email`. That link issues a session, so there is
 * somewhere to arrive; this one issues none (§6), and there is no session to
 * land anywhere with. Every state ends with the way to sign in, which is the
 * only thing this screen can honestly offer whoever is reading it.
 *
 * A page is thin composition (ADR-0049): the feature spends the fragment and
 * this is the shell, the card and the one sentence there is to say.
 */
export const ConfirmEmailPage = () => {
  const { t } = useT("auth");
  const status = useConfirmEmail();
  /*
   * The fallback is the key the route declares, which is `_auth.tsx`'s shape
   * too: the hook's parameter is required, and a screen that is its own shell
   * always matches a route that declares one, so the fallback is unreachable
   * here rather than a second place the copy lives.
   */
  const title = useRouteTitle("auth:confirmEmail.title");

  return (
    <AuthLayout description={undefined} title={title}>
      <Card className="p-5">
        <p className="text-[14px] leading-5 text-muted-foreground">
          {t(MESSAGE_KEY[status])}
        </p>
      </Card>
      {/*
       * Offered on every state but `pending`, where a control would invite
       * somebody to leave a screen that is one response away from answering.
       * Under the card rather than in it — ADR-0054 §7 lists a card's contents
       * as the controls, and "take me to sign in" is not one of them.
       */}
      {status === "pending" ? null : (
        <p className="mt-4 text-center text-[13px] text-muted-foreground">
          <Link
            className="underline underline-offset-4"
            search={{}}
            to="/login"
          >
            {t("confirmEmail.signIn")}
          </Link>
        </p>
      )}
    </AuthLayout>
  );
};
