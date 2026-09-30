import { Link } from "@tanstack/react-router";

import { LoginForm } from "@/features/auth";

import { useT } from "@/shared/i18n";

/**
 * The login screen, inside the auth shell (ADR-0080 §3 over ADR-0054 §7).
 *
 * A page is thin composition: the shell supplies the one card, the brand line,
 * the heading and the lede — the lede travelling on the route as
 * `staticData.description` — and the feature supplies the form and everything
 * it does. What is left here is the order of the card's body.
 *
 * **The way to recovery sits under the form** (`D18.6`, ADR-0071 §4): a way
 * out of this screen rather than a control on it, so it is set apart in the
 * card's small type. It is offered to every operator — §4 gives both
 * populations the flow and makes `super_admin` no exception, which retires the
 * `pnpm db:seed` recovery path's monopoly without retiring the path.
 */
export const LoginPage = () => {
  const { t } = useT("auth");

  return (
    <>
      <LoginForm />
      <p className="mt-4 text-center text-[13px] text-muted-foreground">
        <Link className="underline underline-offset-4" to="/forgot-password">
          {t("links.forgotPassword")}
        </Link>
      </p>
    </>
  );
};
