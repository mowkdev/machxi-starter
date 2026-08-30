import type { ListQuerySearch } from "@repo/contracts";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { userResourceConfig, useUserList } from "@/entities/user";
import {
  UserDialogs,
  useUserRowActions,
  type UserAction,
} from "@/features/users-manage";
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
 * The users screen (`D3.8`) — and the measure of the D3.6 machinery.
 *
 * It is the staff page with two identifiers changed, which is the result the
 * step was designed to test rather than a shortcut taken to reach it: every
 * difference between the two resources — a soft-delete column, a presence
 * filter, nullable names, a status the create endpoint accepts — is declared in
 * `userResourceConfig` and none of it is visible here. If this file had needed
 * to know any of it, that would have been the finding.
 *
 * **`D4.3` makes this the screen where ADR-0042 shows.** The one line below is
 * the same line the staff page has, and it does more here: `/admin/users` is
 * read by `admin` *and* `manager` while its five writes are `admin` only, so a
 * manager sees this screen with Create and Delete absent — and with Edit, Reset
 * password and Sign out everywhere still there, refusing with a `403`, because
 * those three are containment controls that ADR-0042 refuses to hide. That is
 * the D3.8 deferral answered at the layer that draws the affordances, and not
 * an inch further: nothing here decides which requests the API accepts.
 */
export const UsersPage = () => {
  const { t } = useT("users");
  const navigate = useNavigate();
  /*
   * The route's search, **or the snapshot a record surface is carrying**
   * (ADR-0044, `D5.3`). While a dialog or drawer is open the URL is the
   * record's and holds no list params, so reading `useSearch` alone would
   * render this grid at page one, unfiltered, behind the overlay — and
   * closing would land the operator there.
   */
  const listState = useCarriedListState(
    useSearch({ from: "/_dashboard/users" }),
  );
  const { openState } = useRecordNavigation();
  const [action, setAction] = useState<UserAction | null>(null);
  const capabilities = useAllowedCapabilities(userResourceConfig.grid, "users");

  const users = useUserList(toListQuery(listState));

  const onListStateChange = useCallback(
    (next: ListQuerySearch) => {
      void navigate({ to: "/users", search: next });
    },
    [navigate],
  );

  const onAction = useCallback((next: UserAction | null) => {
    setAction(next);
  }, []);

  const closeAction = useCallback(() => {
    setAction(null);
  }, []);

  const rowActions = useUserRowActions(onAction, capabilities);
  const meta = useMemo(() => ({ rowActions }), [rowActions]);

  return (
    /*
     * The page card retired at `D11.3` (ADR-0054 §5) — the staff page carries
     * the reasoning, and it is the same reasoning here: the frame Instrument
     * replaces with band rules was also two links of ADR-0037's height chain,
     * and the page container is now the grid's direct parent. The description
     * moved to the page-header band through the route's `staticData`.
     */
    <>
      <AppGrid
        columns={userResourceConfig.columns}
        page={users.data}
        error={users.error}
        onRetry={() => {
          void users.refetch();
        }}
        listState={listState}
        onListStateChange={onListStateChange}
        meta={meta}
        // `q` searches email and name on this endpoint (`listUsersQuery`).
        searchable
        /*
         * The stances this resource declares (ADR-0039). Not part of the
         * capability block on purpose: ADR-0042 narrows capabilities by
         * role, and nobody's role decides whether a list may be filtered.
         */
        hotFilters={userResourceConfig.grid.hotFilters}
        /*
         * Which arrangement this operator's is (ADR-0041). The resource's
         * own name, so the two grids keep separate entries and neither
         * restores the other's columns; a second grid over the same
         * resource is what the prop exists to let say otherwise.
         */
        gridId={userResourceConfig.name}
        isFetching={users.isFetching}
        emptyMessage="users:empty"
        capabilities={capabilities}
        createAction={
          <Button asChild size="sm">
            <Link to="/users/new" state={openState}>
              <PlusIcon aria-hidden />
              {t("actions.create")}
            </Link>
          </Button>
        }
        onBulkDelete={(ids, { clearSelection }) => {
          setAction({
            kind: "bulk-delete",
            ids,
            rows: users.data?.items ?? [],
            onSettled: clearSelection,
          });
        }}
      />

      <UserDialogs action={action} onClose={closeAction} />
    </>
  );
};
