import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AccountPage } from "@/pages/account";

/**
 * `/account` — the area's layout route (`D12.6`, ADR-0053 §1).
 *
 * Under `_dashboard`, so the guard is inherited rather than remembered
 * (ADR-0049 §Layout topology): the account area is as protected as every other
 * screen because of where its file sits, not because anything here says so.
 *
 * It declares a `title`, which the shell's page-header band reads
 * (ADR-0054 §5) — so `/account/profile` is headed "Profile" by its own file and
 * this one names the area for anything that lands on the layout itself.
 *
 * The `<Outlet />` is here rather than in `pages/account`, because a route file
 * is wiring and a page is composition (ADR-0049).
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
