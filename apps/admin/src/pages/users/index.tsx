import type { ListQuerySearch } from "@repo/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
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
    <Card className="min-h-0 flex-1 overflow-hidden">
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <CardDescription>
          The customer accounts. Deleted ones stay listed, and the Deleted
          column is what says so.
        </CardDescription>
        <CardAction>
          <Button
            onClick={() => {
              setAction({ kind: "create" });
            }}
          >
            <PlusIcon aria-hidden />
            New user
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
