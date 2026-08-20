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
 * The users screen (`D3.8`) — and the measure of the D3.6 machinery.
 *
 * It is the staff page with two identifiers changed, which is the result the
 * step was designed to test rather than a shortcut taken to reach it: every
 * difference between the two resources — a soft-delete column, a presence
 * filter, nullable names, a status the create endpoint accepts — is declared in
 * `userResourceConfig` and none of it is visible here. If this file had needed
 * to know any of it, that would have been the finding.
 */
export const UsersPage = () => {
  const navigate = useNavigate();
  const listState = useSearch({ from: "/_dashboard/users" });
  const [action, setAction] = useState<UserAction | null>(null);

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

  const rowActions = useUserRowActions(onAction);
  const meta = useMemo(() => ({ rowActions }), [rowActions]);

  return (
    <Card className="min-h-0 flex-1">
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <CardDescription>
          The customer accounts. Deleted ones stay listed, and the Deleted
          column is what says so.
        </CardDescription>
        <CardAction>
          {/*
           * A link, not a `setAction` (`D4.2`, ADR-0040): composing a record is
           * addressable state, so the entry point is a navigation and the
           * surface it opens survives a reload. `search: true` keeps the view
           * the operator was reading on the URL while they are away from it.
           *
           * ADR-0038 moves this into the toolbar at `D4.3` and gates it on
           * `canCreate`; until then it stays where D3 put it.
           */}
          <Button asChild>
            <Link to="/users/new" search={true}>
              <PlusIcon aria-hidden />
              New user
            </Link>
          </Button>
        </CardAction>
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
          isFetching={users.isFetching}
          emptyMessage="No users match this view."
        />
      </CardContent>

      <UserDialogs action={action} onClose={closeAction} />
    </Card>
  );
};
