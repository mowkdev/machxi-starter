import { Link } from "@tanstack/react-router";

import { ForgotPasswordForm } from "@/features/auth";

import { useT } from "@/shared/i18n";

/**
 * `/forgot-password` — where recovery is asked for (ADR-0071 §4).
 *
 * A page is thin composition (ADR-0049): the `_auth` shell supplies the one
 * card, the brand line, the heading and the lede from the route's `staticData`
 * (ADR-0080 §3), the feature supplies the form and everything it does, and
 * what is left here is the way back.
 *
 * **The way back sits under the form**, the sign-up screen's shape and for its
 * reason: "I remembered it after all" is a way out, not a control.
 */
export const ForgotPasswordPage = () => {
  const { t } = useT("auth");

  return (
    <>
      <ForgotPasswordForm />
      <p className="mt-4 text-center text-[13px] text-muted-foreground">
        <Link className="underline underline-offset-4" search={{}} to="/login">
          {t("forgot.signIn")}
        </Link>
      </p>
    </>
  );
};
