import type { StaffResource } from "@repo/contracts";
import { useMemo } from "react";

import type { RowAction } from "@/shared/grid/types";

import type { StaffActionHandler } from "./types";

/**
 * The row menu, as data the grid reads through `table.options.meta`
 * (ADR-0035 §Row actions).
 *
 * The split this exists to keep: the entity's config says *there is an actions
 * column*, this feature says *what the actions do*, and neither knows about the
 * other. That is what keeps `staffResourceConfig` free of functions and
 * therefore diffable, mergeable and snapshottable.
 *
 * **Nothing here is disabled by a rule the API owns.** `RowAction.isDisabled`
 * exists and is deliberately unused: whether this account may be deleted
 * depends on the actor's rank, on how many active super admins are left, and on
 * whether the target is the actor — the first two are state this app does not
 * hold and the third would only cover one of the three refusals. Offering the
 * action and rendering the server's answer is honest; greying out one case and
 * silently mishandling the other two is not.
 */
export const useStaffRowActions = (
  onAction: StaffActionHandler,
): readonly RowAction<StaffResource>[] =>
  useMemo(
    () => [
      {
        key: "edit",
        label: "Edit",
        onSelect: (staff) => {
          onAction({ kind: "edit", staff });
        },
      },
      {
        key: "reset-password",
        label: "Reset password",
        onSelect: (staff) => {
          onAction({ kind: "reset-password", staff });
        },
      },
      {
        key: "revoke-sessions",
        label: "Sign out everywhere",
        onSelect: (staff) => {
          onAction({ kind: "revoke-sessions", staff });
        },
      },
      {
        key: "delete",
        label: "Delete",
        destructive: true,
        onSelect: (staff) => {
          onAction({ kind: "delete", staff });
        },
      },
    ],
    [onAction],
  );
