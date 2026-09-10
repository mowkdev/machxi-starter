import { Link } from "@tanstack/react-router";

import {
  ResendVerificationForm,
  useAwaitedAddress,
  useVerifyEmail,
  type VerificationStatus,
} from "@/features/auth";

import { useT } from "@/shared/i18n";
import { useRouteTitle } from "@/shared/lib/route-meta";
import { AuthLayout, Button, Card } from "@/shared/ui";

/**
 * The sentence per state, as a table rather than an interpolated key.
 *
 * A template literal would resolve to the same union today and would stop
 * doing so the moment a state's key stopped matching its name — silently, with
 * i18next returning the key itself. The table is what the compiler checks.
 */
const MESSAGE_KEY = {
  pending: "verify.pending",
  refused: "verify.refused",
  awaiting: "verify.awaiting",
  signedIn: "verify.signedIn",
} as const satisfies Readonly<Record<VerificationStatus, string>>;

/**
 * ADR-0054 §7's 38px rung, as both auth cards spell it — the confirmation is
 * the same size of decision as signing in, in the same card.
 */
const AUTH_CONTROL = "h-[38px] text-[13px]";

/**
 * `/verify-email` — where a sign-up lands and where the mailed link lands
 * (ADR-0071 §3).
 *
 * **One screen for both, and that is the decision this page is.** The plan
 * names a check-your-mail screen and a redemption route; they are the same
 * address in two states of one fact — whether this account's mailbox has been
 * proven yet — and the API puts the link at exactly this path
 * (`MAIL_LINK_PATHS.verifyEmail`). Splitting them would give the resend
 * control two homes and leave a person who followed a dead link on a screen
 * with no way forward, or a second route redirecting to the first.
 *
 * A page is thin composition (ADR-0049): the feature spends the fragment, and
 * this renders the one sentence there is to say while it does — plus, on the
 * two states somebody is left sitting on, the way out.
 *
 * **It composes `AuthLayout` itself rather than sitting under `_auth`**, and
 * that is a constraint rather than a preference — the `/impersonate` screen's
 * constraint exactly. The `_auth` layout guards its children the other way
 * round: a visitor who already has a session is sent home. Somebody may well
 * follow a confirmation link in a browser that already holds one — a second
 * account, a shared machine, a household — and under that guard the exchange
 * would be redirected away before it could run, spending nothing and
 * explaining nothing. The shell is the same one the sign-in screen wears
 * because this is the same moment in a session's life, and the heading still
 * travels on `route-meta` (ADR-0054 §5), which is per route rather than per
 * layout.
 */
export const VerifyEmailPage = () => {
  const { t } = useT("auth");
  const { status, confirm } = useVerifyEmail();
  const awaited = useAwaitedAddress();
  /*
   * The fallback is the same key the route declares, which is `_auth.tsx`'s
   * shape too: the hook's parameter is required, and a screen that is its own
   * shell always matches a route that declares one, so the fallback is
   * unreachable here rather than a second place the copy lives.
   */
  const title = useRouteTitle("auth:verify.title");

  return (
    <AuthLayout description={undefined} title={title}>
      <Card className="flex flex-col gap-4 p-5">
        <p className="text-[14px] leading-5 text-muted-foreground">
          {t(MESSAGE_KEY[status])}
        </p>
        {/*
         * The confirmation the amended §3 asks for, on the one state that
         * holds a live link and has not spent it. A button rather than an
         * automatic redemption is the whole of the fix: it is what makes the
         * exchange something a person did rather than something a link did to
         * them.
         */}
        {status === "signedIn" ? (
          <Button className={AUTH_CONTROL} onClick={confirm} type="button">
            {t("verify.confirm")}
          </Button>
        ) : null}
        {/*
         * Offered on the two states a person is left sitting on with no link
         * in hand, and not on `pending`, where a control would invite somebody
         * to spend a second link over a screen that is one response away from
         * moving on by itself — and where a resend would supersede the very
         * token being redeemed (ADR-0071 §1). Not on `signedIn` either, for
         * that second reason: the link is right there, held.
         */}
        {status === "refused" || status === "awaiting" ? (
          <ResendVerificationForm email={awaited} />
        ) : null}
      </Card>
      {status === "refused" || status === "awaiting" ? (
        <p className="mt-4 text-center text-[13px] text-muted-foreground">
          {/*
           * The way back, under the card rather than in it — the sign-up
           * screen's shape, and for its reason: ADR-0054 §7 lists a card's
           * contents as the controls, and "I have confirmed already" is not
           * one of them.
           */}
          <Link
            className="underline underline-offset-4"
            search={{}}
            to="/login"
          >
            {t("verify.signIn")}
          </Link>
        </p>
      ) : null}
    </AuthLayout>
  );
};
