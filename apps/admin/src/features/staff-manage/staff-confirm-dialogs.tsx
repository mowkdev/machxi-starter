import type { StaffResource } from "@repo/contracts";

import { useDeleteStaff, useRevokeStaffSessions } from "@/entities/staff";
import type { BulkTarget } from "@/shared/api/bulk-outcome";
import { ConfirmDialog } from "@/shared/ui";

import { useBulkDeleteStaff } from "./use-bulk-delete-staff";

/**
 * The two staff actions with no form to host them (ADR-0028, ADR-0018).
 *
 * Both keep ADR-0034's error toast, because a confirm has no field for a
 * refusal to land on — and the refusals here are the interesting part of the
 * step. **None of them is pre-guessed in the client**: the rank rule, the
 * last-super-admin invariant and the self-deletion rule are the service's, they
 * depend on state this app does not hold (how many active super admins exist
 * right now), and a client that guessed would eventually guess wrong in the
 * permissive direction. So the menu offers the action, the API refuses it, and
 * the operator reads the sentence ADR-0034's map wrote for that code.
 */

export const DeleteStaffDialog = ({
  staff,
  onClose,
}: {
  readonly staff: StaffResource;
  readonly onClose: () => void;
}) => {
  const deleteStaff = useDeleteStaff();

  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Delete ${staff.email}?`}
      /*
       * "Cannot be undone" is literally true for staff and would be a lie on
       * the users grid: staff are hard-deleted, the row goes and its role
       * grants cascade with it, while a user is soft-deleted and keeps its row
       * (ADR-0028). Two populations, two sentences.
       */
      description="The account and its role grants are deleted outright. This cannot be undone."
      confirmLabel="Delete"
      destructive
      isPending={deleteStaff.isPending}
      onConfirm={() => {
        deleteStaff.mutate(staff.id, { onSuccess: onClose });
      }}
    />
  );
};

/**
 * The bulk confirm (`D4.3`, ADR-0038): one dialog, one fan-out, one summary.
 *
 * The copy states the count and the resource's *hardness*, which is the same
 * sentence `DeleteStaffDialog` writes for one row — two populations, two
 * sentences (ADR-0028), and a bulk dialog that borrowed the soft one would be
 * wrong about seven accounts at a time instead of one.
 *
 * Nothing is pre-guessed about which of the selection will be refused. The rank
 * rule, the last-super-admin invariant and the self-delete refusal depend on
 * state this app does not hold, so the operator is warned that some may be
 * refused and the summary says which were.
 */
export const BulkDeleteStaffDialog = ({
  ids,
  rows,
  onSettled,
  onClose,
}: {
  readonly ids: readonly string[];
  readonly rows: readonly StaffResource[];
  readonly onSettled: () => void;
  readonly onClose: () => void;
}) => {
  const bulkDelete = useBulkDeleteStaff();

  /*
   * The label is resolved from the page in hand and falls back to the id.
   * Selection survives paging (ADR-0038), so a selected row may not be among
   * `rows` at all — the fallback is the honest floor rather than a blank, and
   * the alternative (fetching the missing rows to name them) would be a request
   * made only so a toast could read better.
   */
  const targets: readonly BulkTarget[] = ids.map((id) => ({
    id,
    label: rows.find((row) => row.id === id)?.email ?? id,
  }));

  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Delete ${ids.length} staff ${ids.length === 1 ? "account" : "accounts"}?`}
      description="The accounts and their role grants are deleted outright. This cannot be undone. Some may be refused — the last super admin, an account that outranks you, or your own — and you will be told which."
      confirmLabel="Delete"
      destructive
      isPending={bulkDelete.isPending}
      onConfirm={() => {
        bulkDelete.mutate(targets, {
          /*
           * `onSuccess`, not `onSettled`: the fan-out's promise resolves
           * whenever `allSettled` does, refusals included, so this runs exactly
           * once for the whole batch — and the refused rows stay on screen with
           * the toast naming why they remain.
           */
          onSuccess: () => {
            onSettled();
            onClose();
          },
        });
      }}
    />
  );
};

export const RevokeStaffSessionsDialog = ({
  staff,
  onClose,
}: {
  readonly staff: StaffResource;
  readonly onClose: () => void;
}) => {
  const revokeSessions = useRevokeStaffSessions();

  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Sign ${staff.email} out everywhere?`}
      description="Every session of this account ends immediately. The account itself is unchanged and they can sign in again."
      confirmLabel="Sign out everywhere"
      isPending={revokeSessions.isPending}
      onConfirm={() => {
        revokeSessions.mutate(staff.id, { onSuccess: onClose });
      }}
    />
  );
};
