import type { ListQuerySearch } from "@repo/contracts";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { staffResourceConfig, useStaffList } from "@/entities/staff";
import {
  StaffDialogs,
  useStaffRowActions,
  type StaffAction,
} from "@/features/staff-manage";
import { toListQuery } from "@/shared/api/list-params";
import { useAllowedCapabilities } from "@/shared/auth";
import { AppGrid } from "@/shared/grid/app-grid";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui";

/**
 * The staff screen (`D3.7`) — and the whole point of it is how little is here.
 *
 * A page is thin composition (ADR-0032): the columns, their sort arrows and
 * their filter controls come from `staffResourceConfig`; the rows, the pager
 * and the search box come from `AppGrid` reading the URL; the dialogs and the
 * row menu come from `features/staff-manage`. What this file decides is the
 * arrangement and one piece of state — which dialog, if any, is open.
 *
 * **The URL is the list state** (ADR-0034). The route validates the search
 * params, this hands them to the query as its key and to the grid as its state,
 * and every control reports back through `navigate`. So a view is a link, the
 * back button walks table states, and the cache falls out correctly because the
 * same URL is the same query key.
 *
 * **`D4.3` added one line and moved one button.** The line is
 * `useAllowedCapabilities`, which is where ADR-0038's config block meets
 * ADR-0042's `can()` — once, above both of the block's readers, so that neither
 * `AppGrid` nor the row-action hook has to know which resource this is. The
 * button is Create, which moves from the `CardHeader`'s `CardAction` into the
 * toolbar, so grid actions have one home instead of one-and-a-half; it is still
 * the `<Link>` `D4.2` made it.
 */
export const StaffPage = () => {
  const navigate = useNavigate();
  const listState = useSearch({ from: "/_dashboard/staff" });
  const [action, setAction] = useState<StaffAction | null>(null);
  const capabilities = useAllowedCapabilities(
    staffResourceConfig.grid,
    "staff",
  );

  /*
   * The route's validated search params *are* the list query — the schema
   * validates the shape and the API enforces the allow-lists (see the route
   * file). `toListQuery` only drops an absent `q`, which
   * `exactOptionalPropertyTypes` makes a real distinction.
   */
  const staff = useStaffList(toListQuery(listState));

  const onListStateChange = useCallback(
    (next: ListQuerySearch) => {
      void navigate({ to: "/staff", search: next });
    },
    [navigate],
  );

  const onAction = useCallback((next: StaffAction | null) => {
    setAction(next);
  }, []);

  const closeAction = useCallback(() => {
    setAction(null);
  }, []);

  const rowActions = useStaffRowActions(onAction, capabilities);
  const meta = useMemo(() => ({ rowActions }), [rowActions]);

  return (
    <Card className="min-h-0 flex-1">
      <CardHeader>
        <CardTitle>Staff</CardTitle>
        <CardDescription>
          The operators who can reach this panel.
        </CardDescription>
      </CardHeader>

      {/*
       * The Card is part of the height budget, not decoration around it
       * (ADR-0037): every wrapper between the page container and AppGrid
       * carries `flex flex-col flex-1 min-h-0`, or the budget reverts to
       * document scroll and the sticky header comes unstuck.
       *
       * And it deliberately does *not* clip: `min-h-0` lets the Card shrink to
       * whatever the viewport left it, so on a viewport too short for the
       * grid's own floor the scroll body overflows this box on purpose and the
       * document scrolls. An `overflow-hidden` here looks tidier and silently
       * eats the pager instead — measured in the browser at `D4.1`, which is
       * the only tier that can see it.
       */}
      <CardContent className="flex min-h-0 flex-1 flex-col">
        <AppGrid
          columns={staffResourceConfig.columns}
          page={staff.data}
          // The error panel ADR-0034 premises silent queries on. Without it a
          // refused or failed list is five skeleton rows that never resolve.
          error={staff.error}
          onRetry={() => {
            void staff.refetch();
          }}
          listState={listState}
          onListStateChange={onListStateChange}
          meta={meta}
          // `q` searches email and name on this endpoint (`listStaffQuery`),
          // which is a property of the API rather than of any column — so it is
          // the toolbar's and not any header's (ADR-0035, amended D3.6). That
          // is also why it is the one control ADR-0039 left live-committing.
          searchable
          /*
           * The stances this resource declares (ADR-0039). Not part of the
           * capability block on purpose: ADR-0042 narrows capabilities by
           * role, and nobody's role decides whether a list may be filtered.
           */
          hotFilters={staffResourceConfig.grid.hotFilters}
          isFetching={staff.isFetching}
          emptyMessage="No staff match this view."
          capabilities={capabilities}
          createAction={
            /*
             * A link, not a handler (`D4.2`, ADR-0040): composing a record is
             * addressable state, so the entry point is a navigation and the
             * surface it opens survives a reload. `search: true` keeps the view
             * the operator was reading on the URL while they are away from it.
             *
             * It is passed as a node rather than as `onCreate` because a
             * `() => void` cannot produce an `<a>` — the amendment ADR-0038
             * carries at `D4.3`. The capability still decides whether it
             * renders at all.
             */
            <Button asChild size="sm">
              <Link to="/staff/new" search={true}>
                <PlusIcon aria-hidden />
                New staff member
              </Link>
            </Button>
          }
          onBulkDelete={(ids, { clearSelection }) => {
            /*
             * The rows the grid holds travel with the action so refusals can be
             * reported by address; `clearSelection` travels with it because the
             * selection has to end when the fan-out does and the state that
             * holds it lives inside `AppGrid`.
             */
            setAction({
              kind: "bulk-delete",
              ids,
              rows: staff.data?.items ?? [],
              onSettled: clearSelection,
            });
          }}
        />
      </CardContent>

      <StaffDialogs action={action} onClose={closeAction} />
    </Card>
  );
};
