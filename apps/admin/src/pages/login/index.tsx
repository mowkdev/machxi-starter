import { Link } from "@tanstack/react-router";

import { LoginForm } from "@/features/auth";

import { useT } from "@/shared/i18n";
import { Card } from "@/shared/ui";

/**
 * The login screen, inside the shell of ADR-0054 §7 (`D11.7`).
 *
 * A page is thin composition: the shell supplies the brand line, the heading
 * and the lede, the feature supplies the form and everything it does, and what
 * is left here is the card the reference draws around the controls.
 *
 * **The card holds the controls and nothing else.** §7 lists its contents as
 * exactly that, so the subtitle that used to sit in a `CardHeader` moved to the
 * heading block above it, travelling on the route as `staticData.description` —
 * the channel `D11.3` opened when the grid pages' cards retired for the same
 * reason. With one child there is no header and no content wrapper left to hang
 * padding on, so the card carries §3's own 20px card padding directly, over the
 * primitive's 24 — through `cn`, so `packages/ui/src/components/` stays
 * byte-identical (ADR-0047). Its radius is already §7's 8: `Card` is the one
 * generated primitive whose `rounded-xl` agrees with the assignment.
 *
 * **The way to recovery sits under the card** (`D18.6`, ADR-0071 §4), for the
 * reason the subtitle left it: a card's contents are the controls, and this is
 * a way out of this screen rather than a control on it. It is offered to every
 * operator — §4 gives both populations the flow and makes `super_admin` no
 * exception, which retires the `pnpm db:seed` recovery path's monopoly without
 * retiring the path.
 */
export const LoginPage = () => {
  const { t } = useT("auth");

  return (
    <>
      <Card className="p-5">
        <LoginForm />
      </Card>
      <p className="mt-4 text-center text-[13px] text-muted-foreground">
        <Link className="underline underline-offset-4" to="/forgot-password">
          {t("links.forgotPassword")}
        </Link>
      </p>
    </>
  );
};
