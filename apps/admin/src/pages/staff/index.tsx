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
import { useT } from "@/shared/i18n";
import { AppGrid } from "@/shared/grid/app-grid";
import {
  useCarriedListState,
  useRecordNavigation,
} from "@/shared/grid/record-navigation";
import { Button } from "@/shared/ui";

/**
 * The staff screen (`D3.7`) — and the whole point of it is how little is here.
 *
 * A page is thin composition (ADR-0032): the columns, their sort and
 * filter controls come from `staffResourceConfig`; the rows, the pager
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
  const { t } = useT("staff");
  const navigate = useNavigate();
  /*
   * The route's search, **or the snapshot a record surface is carrying**
   * (ADR-0044, `D5.3`). While a dialog or drawer is open the URL is the
   * record's and holds no list params, so reading `useSearch` alone would
   * render this grid at page one, unfiltered, behind the overlay — and
   * closing would land the operator there.
   */
  const listState = useCarriedListState(
    useSearch({ from: "/_dashboard/staff" }),
  );
  const { openState } = useRecordNavigation();
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
    /*
     * **The page card retired at `D11.3`** (ADR-0054 §5). It was two things at
     * once: the grid's frame, which Instrument replaces with band rules, and
     * two links of ADR-0037's height chain — `Card` and `CardContent`, each
     * carrying `flex flex-col flex-1 min-h-0`. Removing it removes the frame
     * *and* shortens the chain, because the page container is now the grid's
     * direct parent and already carries `flex-1 min-h-0` in full-height mode.
     * The budget is unchanged; it just has two fewer boxes to divide through.
     *
     * The description went with it, to the shell's page-header band by way of
     * the route's `staticData` — beside the title, which is where a sentence
     * about the screen belongs.
     */
    <>
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
        /*
         * Whether this endpoint has a `q` at all is the resource's claim, not
         * the page's, and since `D14.10` it is read from the config like the
         * columns and the stances beside it (ADR-0063 §2) — which is what lets
         * `assertConfigMatchesContract` check it against `listStaffQuery`. It
         * remains the one control ADR-0039 left live-committing.
         */
        searchable={staffResourceConfig.grid.searchable}
        /*
         * The stances this resource declares (ADR-0039). Not part of the
         * capability block on purpose: ADR-0042 narrows capabilities by
         * role, and nobody's role decides whether a list may be filtered.
         */
        hotFilters={staffResourceConfig.grid.hotFilters}
        /*
         * Which arrangement this operator's is (ADR-0041). The resource's
         * own name, so the two grids keep separate entries and neither
         * restores the other's columns; a second grid over the same
         * resource is what the prop exists to let say otherwise.
         */
        gridId={staffResourceConfig.name}
        isFetching={staff.isFetching}
        emptyMessage="staff:empty"
        capabilities={capabilities}
        createAction={
          /*
           * A link, not a handler (`D4.2`, ADR-0040): composing a record is
           * addressable state, so the entry point is a navigation and the
           * surface it opens survives a reload. Since `D5.3` the view the
           * operator was reading travels as history state rather than on the
           * URL, so the create surface's address is `/staff/new` and nothing
           * more (ADR-0044).
           *
           * It is passed as a node rather than as `onCreate` because a
           * `() => void` cannot produce an `<a>` — the amendment ADR-0038
           * carries at `D4.3`. The capability still decides whether it
           * renders at all.
           */
          /*
           * 34px since `D11.12`: this button is drawn in the page-header
           * band now, beside two 34x34 icon controls, and §5 names the
           * height where it names them ("icon buttons 34x34 and the
           * primary"). `size="sm"` keeps the primitive's padding, gap and
           * type, which is §2's rule for a value only the CLI spells.
           */
          <Button asChild size="sm" className="h-[34px]">
            <Link to="/staff/new" state={openState}>
              <PlusIcon aria-hidden />
              {t("actions.create")}
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

      <StaffDialogs action={action} onClose={closeAction} />
    </>
  );
};
