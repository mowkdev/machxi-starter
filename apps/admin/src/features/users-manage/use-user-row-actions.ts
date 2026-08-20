import type { UserResource } from "@repo/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import type { RowAction } from "@/shared/grid/types";
import type { GridCapabilities } from "@/shared/resource/types";

import type { UserActionHandler } from "./types";

/**
 * The row menu, as data the grid reads through `table.options.meta`
 * (ADR-0035 §Row actions).
 *
 * **Nothing here is disabled on account of `deletedAt`, and that is a
 * decision rather than an oversight.** Every write on a soft-deleted account
 * is refused with `409 USER_DELETED` (ADR-0028), and the row *does* carry the
 * `deletedAt` that would let this predict it — which is exactly why it is worth
 * saying why it does not:
 *
 * - the row is a page that may be minutes old, so the prediction can be wrong
 *   in both directions, and the permissive direction is the one that matters;
 * - the API is the enforcement point (ADR-0019), and a menu that greys itself
 *   out is an affordance, not a guard — building the affordance as though it
 *   were a guard is how the two get confused;
 * - the refusal has a sentence written for it in the ADR-0034 map, and a code
 *   whose message is never reachable is a code nobody maintains.
 *
 * What the client does with `deletedAt` is **show** it: the grid's `Deleted`
 * column marks the account, so an operator is not surprised by the refusal —
 * they can see the reason for it before they act.
 *
 * **`edit` is a navigation since `D4.2`** (ADR-0040) — it puts the record in
 * the URL, where a reload and the Back button can both reach it — while the
 * other three still report into the page's own state, because a destructive
 * confirm and a credential ceremony must not be addressable. The staff menu
 * splits the same way for the same reason.
 *
 * **Since `D4.3` the menu reads the capability block** (ADR-0038), already
 * narrowed by ADR-0042's `can()`. This resource is where that narrowing earns
 * its keep: `/admin/users` mounts `authorize("admin", "manager")` and the router
 * refines five writing routes back to `admin`, so a `manager` reaching this
 * screen was offered five writes the API refuses. Two of them go — Create and
 * Delete. **The other three deliberately stay**, because reset password, sign
 * out everywhere and the disable path inside `edit` are the controls somebody
 * reaches for during an incident, and a hidden one is a silent absence with
 * nothing to escalate (ADR-0042 §Containment controls).
 */
export const useUserRowActions = (
  onAction: UserActionHandler,
  /** Required, never optional — `use-staff-row-actions.ts` says why. */
  capabilities: GridCapabilities | undefined,
): readonly RowAction<UserResource>[] => {
  const navigate = useNavigate();

  return useMemo(() => {
    const actions: RowAction<UserResource>[] = [];

    if (capabilities?.canEdit === true)
      actions.push({
        key: "edit",
        label: "Edit",
        onSelect: (user) => {
          void navigate({
            to: "/users/$userId",
            params: { userId: user.id },
            // The list's own state stays on the URL while the record is open,
            // so closing returns to the page and filters being read.
            search: true,
          });
        },
      });

    actions.push(
      {
        key: "reset-password",
        label: "Reset password",
        onSelect: (user) => {
          onAction({ kind: "reset-password", user });
        },
      },
      {
        key: "revoke-sessions",
        label: "Sign out everywhere",
        onSelect: (user) => {
          onAction({ kind: "revoke-sessions", user });
        },
      },
    );

    if (capabilities?.canDelete === true)
      actions.push({
        key: "delete",
        label: "Delete",
        destructive: true,
        onSelect: (user) => {
          onAction({ kind: "delete", user });
        },
      });

    return actions;
  }, [capabilities, navigate, onAction]);
};
