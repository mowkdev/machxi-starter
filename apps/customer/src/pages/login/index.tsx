import { Link, useRouteContext, useSearch } from "@tanstack/react-router";

import { ContinueWithGoogle, LoginForm } from "@/features/auth";

import { useT } from "@/shared/i18n";

/**
 * The sign-in screen, inside the auth shell (ADR-0080 §3 over ADR-0054 §7).
 *
 * A page is thin composition: the shell supplies the one card, the brand line,
 * the heading and the lede — the lede travelling on the route as
 * `staticData` — and what is left here is the order of the card's body: the
 * form, then the second way in, then the ways out.
 *
 * **The link to `/register` is gated on the same fact the route is** (`D15.6`,
 * ADR-0067 §6): both read `features.userRegistration` off the router context,
 * so a build with registration off cannot offer a way into an address that
 * answers not-found. Two readers of one value rather than two values that have
 * to be kept in agreement.
 *
 * **"Continue with Google" sits under the form, not in it** (ADR-0072 §4):
 * Google is a second way in beside the password form rather than a field of
 * it. Gated on the build's flag, read off
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
      <LoginForm />
      {features.googleSignIn ? (
        <div className="mt-4">
          <ContinueWithGoogle redirect={redirect} />
        </div>
      ) : null}
      {/*
       * Recovery, under the form with the other way out (ADR-0071 §4). It is
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
