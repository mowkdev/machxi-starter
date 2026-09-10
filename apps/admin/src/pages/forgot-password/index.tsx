import { Link } from "@tanstack/react-router";

import { ForgotPasswordForm } from "@/features/auth";

import { useT } from "@/shared/i18n";
import { Card } from "@/shared/ui";

/**
 * `/forgot-password` — where an operator asks for recovery (ADR-0071 §4).
 *
 * A page is thin composition (ADR-0049): the `_auth` shell supplies the brand
 * line, the heading and the lede from the route's `staticData`, the feature
 * supplies the form and everything it does, and what is left here is the card
 * the reference draws around the controls (ADR-0054 §7) and the way back.
 *
 * The card carries §3's 20px padding directly, over the primitive's 24 —
 * through `className`, so `packages/ui/src/components/` stays byte-identical
 * (ADR-0047) — exactly as the sign-in card does.
 *
 * **The way back sits under the card rather than in it**: §7 lists a card's
 * contents as the controls, and "I remembered it after all" is not one.
 */
export const ForgotPasswordPage = () => {
  const { t } = useT("auth");

  return (
    <>
      <Card className="p-5">
        <ForgotPasswordForm />
      </Card>
      <p className="mt-4 text-center text-[13px] text-muted-foreground">
        <Link className="underline underline-offset-4" search={{}} to="/login">
          {t("forgot.signIn")}
        </Link>
      </p>
    </>
  );
};
