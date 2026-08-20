import type { StaffResource } from "@repo/contracts";
import { useNavigate } from "@tanstack/react-router";
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
 * **Since `D4.2` the menu speaks two languages** (ADR-0040), and the difference
 * is visible right here: `edit` is a *navigation* — it puts the record in the
 * URL, so the surface it opens is reload-restorable and Back closes it — while
 * the other three still report through `onAction` into the page's own state,
 * because none of them may be deep-linkable. One menu, two regimes, and the
 * reason for each is the kind of thing the item opens rather than a preference.
 *
 * **Nothing here is disabled by a rule the API owns.** `RowAction.isDisabled`
 * exists and is deliberately unused: whether this account may be deleted
 * depends on the actor's rank, on how many active super admins are left, and on
 * whether the target is the actor — the first two are state this app does not
 * hold and the third would only cover one of the three refusals. Offering the
 * action and rendering the server's answer is honest; greying out one case and
 * silently mishandling the other two is not. (ADR-0042 gates affordances on the
 * operator's *role* at `D4.3`, which is a different claim from this one.)
 */
export const useStaffRowActions = (
  onAction: StaffActionHandler,
): readonly RowAction<StaffResource>[] => {
  const navigate = useNavigate();

  return useMemo(
    () => [
      {
        key: "edit",
        label: "Edit",
        onSelect: (staff) => {
          /*
           * `search: true` keeps the list's own state on the URL while the
           * record is open, which is what lets closing return the operator to
           * the page and filters they were reading (ADR-0040).
           */
          void navigate({
            to: "/staff/$staffId",
            params: { staffId: staff.id },
            search: true,
          });
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
    [navigate, onAction],
  );
};
