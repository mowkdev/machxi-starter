import { useT } from "@repo/i18n";
import { Button } from "@repo/ui/components/button";
import type { ReactNode } from "react";

/**
 * The router's error and not-found components (ADR-0062 §1), extracted from
 * `apps/customer` at `D14.8` — and the admin gains them in the same step.
 *
 * **The router's own defaults are not shippable.** `defaultErrorComponent`
 * renders `error.message` behind a **Show Error** button and
 * `defaultNotFoundComponent` renders the string `"Not Found"`, both in
 * production and both in English. `D12.2`'s review caught it in the customer
 * app and fixed it there; the admin has been running the router's defaults
 * ever since, which is exactly the asymmetry this record exists to end.
 *
 * `errors:` is the namespace every code-mapped sentence lives in (ADR-0046
 * §2), and both apps' drift checks already treat the whole namespace as
 * resolved at runtime — so no key here needs an exemption.
 */
const Notice = ({
  action,
  children,
}: {
  action?: ReactNode;
  children: string;
}) => (
  <div
    className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background p-6 text-center text-sm text-muted-foreground"
    role="alert"
  >
    <p>{children}</p>
    {action}
  </div>
);

/**
 * What a route renders when its loader or its component threw. Deliberately
 * the `fallback` sentence rather than the thrown value: ADR-0013 keeps a
 * server's internals off the wire, and a client's belong on screen no more.
 *
 * **No action here, and that is not an oversight**: the router remounts this
 * route's component on the next navigation, so the shell around it — sidebar,
 * account menu, breadcrumb — is still on screen and still the way out.
 */
export const AppError = (): ReactNode => {
  const { t } = useT("errors");

  return <Notice>{t("fallback")}</Notice>;
};

/** What an unmatched path renders — the `ROUTE_NOT_FOUND` sentence. */
export const AppNotFound = (): ReactNode => {
  const { t } = useT("errors");

  return <Notice>{t("ROUTE_NOT_FOUND")}</Notice>;
};

/**
 * What the **top-level** boundary renders (ADR-0062 §2, amended at `D14.8`).
 *
 * The same sentence as `AppError` and one thing more: a way out. A throw above
 * the router takes the shell with it, so there is no navigation left to
 * recover on and a boundary that latched `failed` would otherwise leave a
 * permanently dead window — which is a worse failure than the white screen
 * this record set out to replace.
 *
 * A **reload**, not a `setState` reset: whatever the render threw is still in
 * whatever state produced it, and clearing a boolean would re-run the same
 * render on the same inputs. `window.location.reload()` discards the client's
 * state, and the session survives it (ADR-0018's refresh cookie is `httpOnly`
 * and the boot gate re-mints from it), so the cost is the boot the loader
 * already covers rather than a sign-out.
 *
 * The label is `common:actions.retry`, which both apps' catalogues already
 * carry for `QueryError`'s retry — so this surface adds no key, and the drift
 * check keeps seeing the literal in each app's own `query-error.tsx`.
 */
export const AppCrash = (): ReactNode => {
  const { t } = useT("errors");
  const { t: common } = useT("common");

  return (
    <Notice
      action={
        <Button
          onClick={() => {
            window.location.reload();
          }}
          size="sm"
          variant="outline"
        >
          {common("actions.retry")}
        </Button>
      }
    >
      {t("fallback")}
    </Notice>
  );
};
