import type { StaffResource } from "@repo/contracts";

import { useDeleteStaff, useRevokeStaffSessions } from "@/entities/staff";
import { ConfirmDialog } from "@/shared/ui";

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
