import type { UserResource } from "@repo/contracts";
import { useMemo } from "react";

import type { RowAction } from "@/shared/grid/types";

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
 */
export const useUserRowActions = (
  onAction: UserActionHandler,
): readonly RowAction<UserResource>[] =>
  useMemo(
    () => [
      {
        key: "edit",
        label: "Edit",
        onSelect: (user) => {
          onAction({ kind: "edit", user });
        },
      },
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
      {
        key: "delete",
        label: "Delete",
        destructive: true,
        onSelect: (user) => {
          onAction({ kind: "delete", user });
        },
      },
    ],
    [onAction],
  );
