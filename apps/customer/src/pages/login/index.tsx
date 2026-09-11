import { Link, useRouteContext, useSearch } from "@tanstack/react-router";

import { ContinueWithGoogle, LoginForm } from "@/features/auth";

import { useT } from "@/shared/i18n";
import { Card } from "@/shared/ui";

/**
 * The sign-in screen, inside the shell of ADR-0054 §7.
 *
 * A page is thin composition: the shell supplies the brand line, the heading
 * and the lede, and what is left here is the card the reference draws around
 * the controls.
 *
 * The card holds the controls and nothing else: ADR-0054 §7 lists its contents
 * as exactly that, and the brand line, the heading and the lede sit above it in
 * the shell, travelling on the route as `staticData`.
 *
 * The card carries §3's own 20px card padding directly, over the primitive's 24
 * — through `className`, so `packages/ui/src/components/` stays byte-identical
 * (ADR-0047). Its radius is already §7's 8: `Card` is the one generated
 * primitive whose `rounded-xl` agrees with the assignment.
 *
 * **The link to `/register` is gated on the same fact the route is** (`D15.6`,
 * ADR-0067 §6): both read `features.userRegistration` off the router context,
 * so a build with registration off cannot offer a way into an address that
 * answers not-found. Two readers of one value rather than two values that have
 * to be kept in agreement.
 *
 * **"Continue with Google" sits under the card, not in it** (ADR-0072 §4):
 * the card is the password form and its controls, and Google is a second way
 * in beside it rather than a field of it. Gated on the build's flag, read off
 * the same router context; the API's mount is still the control. It is
 * handed the screen's `redirect`, so a person turned away by the guard or sent
 * from an invitation lands where a password sign-in would have taken them
 * (ADR-0072 §4, amended after `D19.3`).
 */
export const LoginPage = () => {
  const { t } = useT("auth");
  const { features } = useRouteContext({ from: "/_auth/login" });
  const { redirect } = useSearch({ from: "/_auth/login" });

  return (
    <>
      <Card className="p-5">
        <LoginForm />
      </Card>
      {features.googleSignIn ? (
        <div className="mt-4">
          <ContinueWithGoogle redirect={redirect} />
        </div>
      ) : null}
      {/*
       * Recovery, under the card with the other way out (ADR-0071 §4). It is
       * ungated where the sign-up link is gated, and the asymmetry is the
       * point: `FEATURE_USER_REGISTRATION` decides whether *new* accounts may
       * be made here, and an account that already exists must be recoverable
       * whatever a deployment has since decided about sign-ups.
       */}
      <p className="mt-4 text-center text-[13px] text-muted-foreground">
        <Link className="underline underline-offset-4" to="/forgot-password">
          {t("links.forgotPassword")}
        </Link>
      </p>
      {features.userRegistration ? (
        <p className="mt-2 text-center text-[13px] text-muted-foreground">
          <Link className="underline underline-offset-4" to="/register">
            {t("links.register")}
          </Link>
        </p>
      ) : null}
    </>
  );
};
