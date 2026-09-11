import { Link, useRouteContext } from "@tanstack/react-router";

import { ContinueWithGoogle, RegisterForm } from "@/features/auth";

import { useT } from "@/shared/i18n";
import { Card } from "@/shared/ui";

/**
 * The sign-up screen (`D15.6`, ADR-0067 §6), inside the shell of ADR-0054 §7.
 *
 * The sign-in screen's twin: the shell supplies the brand line, the heading and
 * the lede from the route's `staticData`, and what is left here is the card the
 * reference draws around the controls, carrying §3's 20px padding over the
 * primitive's 24 through `className` so `packages/ui/src/components/` stays
 * byte-identical (ADR-0047).
 *
 * The way back is under the card rather than in it. ADR-0054 §7 lists a card's
 * contents as the controls, and "I already have an account" is not one of them;
 * it is also the only navigation on this screen, so putting it outside the card
 * keeps the card a form.
 *
 * **"Continue with Google" is under the card behind both flags** (ADR-0072
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
      <Card className="p-5">
        <RegisterForm />
      </Card>
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
