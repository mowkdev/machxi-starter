import type { UserResource } from "@repo/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useRecordNavigation } from "@/shared/grid/record-navigation";
import { useMemo } from "react";

import { useCan } from "@/shared/auth";
import { useT } from "@/shared/i18n";
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
 * **Impersonate is gated by `can()` directly, and it is the first entry here
 * that is** (`D13.8`, ADR-0057 §7). Every other flag in this menu arrives
 * pre-narrowed in the capability block, which is ADR-0042's arrangement and
 * exists so `shared/grid` never learns a resource's name — but `impersonate`
 * is not a grid capability and must not become one: `GridCapabilities` lives in
 * `@repo/resource`, a platform package every app is built from, and a
 * `canImpersonate` flag there would put one deployment's feature in the
 * vocabulary of all of them. So the conjunction happens here instead, where the
 * resource's name is already known, and the block keeps the four flags a grid
 * actually reads.
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
  const { t } = useT("users");
  const navigate = useNavigate();
  const can = useCan();
  const { openState } = useRecordNavigation();

  return useMemo(() => {
    const actions: RowAction<UserResource>[] = [];

    if (capabilities?.canEdit === true)
      actions.push({
        key: "edit",
        label: t("actions.edit"),
        onSelect: (user) => {
          void navigate({
            to: "/users/$userId",
            params: { userId: user.id },
            // The record's URL carries the record and nothing else; the list's
            // page and filters travel as history state (ADR-0044, `D5.3`).
            state: openState,
          });
        },
      });

    /*
     * Between the navigation and the credential controls, which is where it
     * belongs on both counts: it is a way of *looking at* the account rather
     * than of changing it, and it is not one of the three ADR-0042 keeps
     * permanently visible. A `manager` never sees it — the one entry in this
     * menu `can()` removes rather than defers, because impersonation is not a
     * containment control and hiding it costs nobody anything during an
     * incident. (Not because a refused `manager` would spend rate-limit
     * budget: ADR-0057 §1's limiter mounts after `authorize`, so they spend
     * nothing. The budget argument belongs to `isDisabled` below, where the
     * caller is an `admin` and the request really is made.)
     *
     * **`isDisabled` predicts a refusal here, and nowhere else in this menu.**
     * The paragraph at the top of this file declines to grey out the other
     * four actions on a soft-deleted row, and every clause of that argument
     * inverts for this one. The permissive direction is what mattered there —
     * those are containment controls somebody reaches for mid-incident, and a
     * stale row must not stop them; nothing about an incident calls for
     * impersonating anybody. And the mint *is* rate-limited per acting staff
     * member (ADR-0057 §1), so a doomed press by an `admin` — the only
     * principal who sees this entry — really does spend one of ten. What it
     * buys the operator is the refusal they would otherwise read as the
     * catalogue's generic conflict sentence, which ADR-0057 §1's `D13.8`
     * amendment concedes says nothing useful. The cost is a stale row that has
     * just become active and greys a mint the API would have allowed; the grid
     * shows `Status` and `Deleted` in the same row, so the operator can see
     * why, and a refetch is the fix.
     */
    if (can("impersonate", "users"))
      actions.push({
        key: "impersonate",
        label: t("actions.impersonate"),
        isDisabled: (user) =>
          user.deletedAt !== null || user.status !== "active",
        onSelect: (user) => {
          onAction({ kind: "impersonate", user });
        },
      });

    actions.push(
      {
        key: "reset-password",
        label: t("actions.resetPassword"),
        onSelect: (user) => {
          onAction({ kind: "reset-password", user });
        },
      },
      {
        key: "revoke-sessions",
        label: t("actions.revokeSessions"),
        onSelect: (user) => {
          onAction({ kind: "revoke-sessions", user });
        },
      },
    );

    if (capabilities?.canDelete === true)
      actions.push({
        key: "delete",
        label: t("actions.delete"),
        destructive: true,
        onSelect: (user) => {
          onAction({ kind: "delete", user });
        },
      });

    return actions;
  }, [can, capabilities, navigate, onAction, openState, t]);
};
