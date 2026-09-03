import { Link } from "@tanstack/react-router";

import { useRedeemHandoff, type HandoffStatus } from "@/features/impersonation";

import { useT } from "@/shared/i18n";
import { useRouteTitle } from "@/shared/lib/route-meta";
import { AuthLayout, Card } from "@/shared/ui";

/**
 * The sentence per state, as a table rather than an interpolated key.
 *
 * A template literal would resolve to the same union today and would stop
 * doing so the moment a state's key stopped matching its name — silently, with
 * i18next returning the key itself. The table is what the compiler checks.
 */
const MESSAGE_KEY = {
  pending: "exchange.pending",
  refused: "exchange.refused",
  missing: "exchange.missing",
} as const satisfies Readonly<Record<HandoffStatus, string>>;

/**
 * The screen the admin panel's Impersonate action lands on (`D13.7`,
 * ADR-0057 §7).
 *
 * A page is thin composition (ADR-0049): the feature spends the fragment and
 * this renders the one sentence there is to say while it does.
 *
 * **It composes `AuthLayout` itself rather than sitting under `_auth`, and
 * that is a constraint rather than a preference.** The `_auth` layout route
 * guards its children the other way round — a visitor who already has a
 * session is sent home — and an operator who is also a customer, or who has
 * simply used this browser before, arrives here *with* one: ADR-0057 §3 says
 * so in as many words, and overwriting that browser's cookies is the design
 * rather than an edge case. Under that guard the exchange would be redirected
 * away before it could run. The shell is the same one the sign-in screen wears
 * because this is the same moment in a session's life. The **heading still
 * travels on `route-meta`** (ADR-0054 §5): the page reads what the route
 * declares about itself, exactly as `_auth.tsx` does for its children, so
 * composing the shell here changes where the frame comes from and not where
 * the copy does. The first draft gave those two as one reason, which they are
 * not — `staticData` is per route and `useRouteTitle` reads the matched chain
 * whatever layout a route sits under (`D13.7`'s review).
 *
 * Three states, all of them terminal or transient by construction: `pending`
 * ends in a navigation home, and the other two end wherever the operator goes
 * next. There is no retry control, because there is nothing to retry with — a
 * handoff is one-time and sixty seconds long (ADR-0057 §2), so the only way
 * forward is a fresh mint from the admin panel, which is what the copy says.
 */
export const ImpersonatePage = () => {
  const { t } = useT("impersonation");
  const status = useRedeemHandoff();
  /*
   * The fallback is the same key the route declares, which is `_auth.tsx`'s
   * shape too (`auth:title` is both its fallback and `_auth.login`'s
   * `staticData`): the hook's parameter is required, and a screen that is its
   * own shell always matches a route that declares one, so the fallback is
   * unreachable here rather than a second place the copy lives.
   */
  const title = useRouteTitle("impersonation:exchange.title");

  return (
    <AuthLayout description={undefined} title={title}>
      <Card className="flex flex-col items-start gap-4 p-5">
        <p className="text-[14px] leading-5 text-muted-foreground">
          {t(MESSAGE_KEY[status])}
        </p>
        {/*
         * Offered on the two states a person is left sitting on, and not on
         * `pending`, where a link would invite somebody to leave a screen that
         * is one response away from moving on by itself.
         *
         * `/login` is where an operator who cannot get in this way goes: it is
         * this app's signed-out screen, and its own guard sends them home
         * instead if the browser still holds a live customer session — which
         * is the correct answer for the one case where a refused exchange
         * leaves them signed in as somebody real.
         */}
        {status === "pending" ? null : (
          <Link
            className="text-[14px] leading-5 font-medium underline underline-offset-4"
            search={{}}
            to="/login"
          >
            {t("exchange.signIn")}
          </Link>
        )}
      </Card>
    </AuthLayout>
  );
};
