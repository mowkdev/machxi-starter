import { Link, useRouteContext } from "@tanstack/react-router";

import { ContinueWithGoogle, RegisterForm } from "@/features/auth";

import { useT } from "@/shared/i18n";

/**
 * The sign-up screen (`D15.6`, ADR-0067 §6), inside the auth shell (ADR-0080
 * §3 over ADR-0054 §7).
 *
 * The sign-in screen's twin: the shell supplies the one card, the brand line,
 * the heading and the lede from the route's `staticData`, and what is left here
 * is the order of the card's body.
 *
 * The way back is under the form, in the card's small type: "I already have an
 * account" is the only navigation on this screen, not a control of the form.
 *
 * **"Continue with Google" is under the form behind both flags** (ADR-0072
 * §4). Registration's is already true on this screen — its route answers
 * not-found otherwise — and is read again here anyway, so the condition says
 * what the record says rather than what the route happens to guarantee:
 * Google *creates* an account where registration is open (§1), so the button
 * belongs on the sign-up screen only where both halves are.
 */
export const RegisterPage = () => {
  const { t } = useT("auth");
  const { features } = useRouteContext({ from: "/_auth/register" });

  return (
    <>
      <RegisterForm />
      {features.userRegistration && features.googleSignIn ? (
        <div className="mt-4">
          <ContinueWithGoogle />
        </div>
      ) : null}
      <p className="mt-4 text-center text-[13px] text-muted-foreground">
        <Link className="underline underline-offset-4" to="/login">
          {t("register.haveAccount")}
        </Link>
      </p>
    </>
  );
};
