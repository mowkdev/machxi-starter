import type { ReactNode } from "react";

import { useSignOut } from "@/features/auth";

import { useSession } from "@/shared/api/context";
import { useT } from "@/shared/i18n";
import { Banner, Button } from "@/shared/ui";

/**
 * The banner that says this session is not what it looks like (`D13.7`,
 * ADR-0057 §7, ADR-0048 §3 as carried).
 *
 * **It renders from `principal.impersonatedBy` and from nothing else.** That
 * is the field's whole design (ADR-0057 §4): the fact lives on the session,
 * reaches the client on the principal resource, and is therefore unforgeable —
 * only the API sets it — and survives a reload, because the session does and
 * the boot refresh carries it back. Nothing here reads the URL, `localStorage`
 * or app state; the handoff fragment was the one-time credential, not the
 * fact, and `features/impersonation` spent it two screens ago.
 *
 * **Non-dismissible, which is a prop this component does not pass.** `Banner`
 * defaults `dismissible` to `false` precisely so that the fail-safe direction
 * is a notice that stays (ADR-0048 §3, amended `D8.2`, naming this consumer),
 * and writing `dismissible={false}` would be a line that only looks like a
 * decision. The `warning` variant is the second of the two the design system
 * carries, reserved by name for this since `D8.2`.
 *
 * **The exit is the ordinary logout** (ADR-0057 §6): the service sees the
 * actor column, revokes with `impersonation_ended` and writes the audit row,
 * so this control needs to know none of that — it is `features/auth`'s
 * `useSignOut`, the same hook the account menu presses, landing on `/login`.
 * `POST /user/auth/logout` is deliberately *not* on §5's exclusion list for
 * this reason, and `logout-all` is: one ends the operator's borrowed session,
 * the other would end the customer's real ones.
 */
const ImpersonationBanner = ({
  customer,
  operator,
}: {
  /** The account being used — the session's subject. */
  readonly customer: string;
  /** The staff member using it — the session's actor. */
  readonly operator: string;
}) => {
  const { t } = useT("impersonation");
  const { signOut, pending } = useSignOut();

  return (
    <Banner
      action={
        <Button
          disabled={pending}
          onClick={signOut}
          size="sm"
          type="button"
          variant="outline"
        >
          {t("banner.exit")}
        </Button>
      }
      message={t("banner.message", { customer, operator })}
      variant="warning"
    />
  );
};

/**
 * The node the `_dashboard` layout hands the shell, or nothing at all.
 *
 * **A hook returning a node rather than a component returning `null`**, for
 * the reason `usePseudoLocaleNotice` is one: `AppShell` decides whether to
 * draw the banner region by the truthiness of what it was handed, and an
 * element is truthy whatever the component then returns — so a component form
 * would give every screen of an ordinary session an empty region and shift
 * every page's height budget by it (ADR-0048 §3, amended `D8.7`). The
 * emptiness has to be visible to the caller, which means the decision happens
 * before the JSX exists.
 *
 * `== null` rather than `=== undefined` on the actor: the wire principal is
 * passed through unvalidated by `@repo/api-client`, and `impersonatedBy` is
 * optional-never-`null` by contract (ADR-0057 §4) rather than by anything that
 * checks — the same reading `principal-cache.tsx` takes one layer up, and for
 * the same reason, since this runs above the layout's error boundary.
 */
export const useImpersonationBanner = (): ReactNode => {
  const { principal } = useSession();

  const actor =
    principal?.kind === "user" ? principal.impersonatedBy : undefined;

  return principal == null || actor == null ? undefined : (
    <ImpersonationBanner customer={principal.email} operator={actor.email} />
  );
};
