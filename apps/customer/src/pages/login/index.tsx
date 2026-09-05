import { Link, useRouteContext } from "@tanstack/react-router";

import { LoginForm } from "@/features/auth";

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
 */
export const LoginPage = () => {
  const { t } = useT("auth");
  const { features } = useRouteContext({ from: "/_auth/login" });

  return (
    <>
      <Card className="p-5">
        <LoginForm />
      </Card>
      {features.userRegistration ? (
        <p className="mt-4 text-center text-[13px] text-muted-foreground">
          <Link className="underline underline-offset-4" to="/register">
            {t("links.register")}
          </Link>
        </p>
      ) : null}
    </>
  );
};
