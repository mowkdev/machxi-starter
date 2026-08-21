import type { StaffResource } from "@repo/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useRecordNavigation } from "@/shared/grid/record-navigation";
import { useMemo } from "react";

import type { RowAction } from "@/shared/grid/types";
import type { GridCapabilities } from "@/shared/resource/types";

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
 * silently mishandling the other two is not. ADR-0042 keeps that paragraph
 * verbatim; what it adds is a different claim, below.
 *
 * **Since `D4.3` the menu reads the capability block** (ADR-0038 §One config
 * block, two readers): `AppGrid` reads it for the checkbox column and the
 * toolbar, and this reads it for the menu, so the two cannot disagree about
 * what an operator sees. The block arrives already narrowed by ADR-0042's
 * `can()` — the screen conjoins the two once, above both readers — which is
 * why this file names no resource and no role.
 *
 * **`edit` reads a flag `can()` deliberately leaves alone**, and so do
 * `reset-password` and `revoke-sessions`, which have no flag at all. Those
 * three are incident-containment controls: `revokeSessions` ends a compromised
 * session, `setPassword` takes a stolen credential away, and the only route to
 * `status: "disabled"` today is this `edit` form. A hidden control during an
 * incident is silent — no message, no code, nothing to escalate with — where a
 * visible one that answers `403` tells an operator the control exists and that
 * they need somebody who may use it. So they render for everyone and the server
 * answers (ADR-0042 §Containment controls).
 */
export const useStaffRowActions = (
  onAction: StaffActionHandler,
  /*
   * Required, and explicitly nullable rather than optional (`D4.3` review).
   * With `capabilities?` a call site that forgot the argument would silently
   * drop both `edit` and `delete` — and `edit` is the containment control
   * ADR-0042 says must never be hidden, because the disable path runs through
   * it. That is the failure direction the ADR calls the worse one, and an
   * optional parameter makes it the default behaviour of a typo. `| undefined`
   * keeps "this resource declares nothing" expressible.
   */
  capabilities: GridCapabilities | undefined,
): readonly RowAction<StaffResource>[] => {
  const navigate = useNavigate();
  const { openState } = useRecordNavigation();

  return useMemo(() => {
    const actions: RowAction<StaffResource>[] = [];

    if (capabilities?.canEdit === true)
      actions.push({
        key: "edit",
        label: "Edit",
        onSelect: (staff) => {
          /*
           * The record's URL is the record's alone (ADR-0044, `D5.3`): the
           * list's page and filters ride along as **history state**, so
           * closing still returns the operator to the view they were reading
           * and "look at this account" is a link to an account.
           */
          void navigate({
            to: "/staff/$staffId",
            params: { staffId: staff.id },
            state: openState,
          });
        },
      });

    actions.push(
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
    );

    if (capabilities?.canDelete === true)
      actions.push({
        key: "delete",
        label: "Delete",
        destructive: true,
        onSelect: (staff) => {
          onAction({ kind: "delete", staff });
        },
      });

    return actions;
  }, [capabilities, navigate, onAction, openState]);
};
