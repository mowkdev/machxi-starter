import type { ListQuerySearch } from "@repo/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { staffResourceConfig, useStaffList } from "@/entities/staff";
import {
  StaffDialogs,
  useStaffRowActions,
  type StaffAction,
} from "@/features/staff-manage";
import { toListQuery } from "@/shared/api/list-params";
import { AppGrid } from "@/shared/grid/app-grid";
import {
  Button,
  Card,
  CardAction,
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
 */
export const StaffPage = () => {
  const navigate = useNavigate();
  const listState = useSearch({ from: "/_dashboard/staff" });
  const [action, setAction] = useState<StaffAction | null>(null);

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

  const rowActions = useStaffRowActions(onAction);
  const meta = useMemo(() => ({ rowActions }), [rowActions]);

  return (
    <Card className="min-h-0 flex-1 overflow-hidden">
      <CardHeader>
        <CardTitle>Staff</CardTitle>
        <CardDescription>
          The operators who can reach this panel.
        </CardDescription>
        <CardAction>
          <Button
            onClick={() => {
              setAction({ kind: "create" });
            }}
          >
            <PlusIcon aria-hidden />
            New staff member
          </Button>
        </CardAction>
      </CardHeader>

      {/*
       * The Card is part of the height budget, not decoration around it
       * (ADR-0037): every wrapper between the page container and AppGrid
       * carries `flex flex-col flex-1 min-h-0`, or the budget reverts to
       * document scroll and the sticky header comes unstuck. `overflow-hidden`
       * keeps the scroll body's corners inside the Card's radius.
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
          // the toolbar's and not the filter row's (ADR-0035, amended D3.6).
          searchable
          isFetching={staff.isFetching}
          emptyMessage="No staff match this view."
        />
      </CardContent>

      <StaffDialogs action={action} onClose={closeAction} />
    </Card>
  );
};
