import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AccountPage } from "@/pages/account";

/**
 * `/account` — the area's layout route (ADR-0053 §1).
 *
 * Under `_dashboard`, so the guard is inherited rather than remembered
 * (ADR-0032 §Layout topology): the account area is as protected as every other
 * screen because of where its file sits, not because anything here says so.
 *
 * It declares a `title` and therefore contributes the ancestor crumb every
 * section hangs off — `Account → Profile` (ADR-0048 §2). That is the one thing
 * this route says about itself; the sections say the rest, each from its own
 * file, which is what makes them deep-linkable with their own headings.
 *
 * The `<Outlet />` is here rather than in `pages/account`, because a route file
 * is wiring and a page is composition (ADR-0049, carrying ADR-0032).
 */
export const Route = createFileRoute("/_dashboard/account")({
  component: AccountRoute,
  staticData: { title: "account:title" },
});

function AccountRoute() {
  return (
    <AccountPage>
      <Outlet />
    </AccountPage>
  );
}
