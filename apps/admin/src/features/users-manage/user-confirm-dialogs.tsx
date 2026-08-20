import type { UserResource } from "@repo/contracts";

import { useDeleteUser, useRevokeUserSessions } from "@/entities/user";
import { ConfirmDialog } from "@/shared/ui";

/**
 * The two user actions with no form to host them (ADR-0028, ADR-0018).
 *
 * Both keep ADR-0034's error toast, because a confirm has no field for a
 * refusal to land on.
 */

export const DeleteUserDialog = ({
  user,
  onClose,
}: {
  readonly user: UserResource;
  readonly onClose: () => void;
}) => {
  const deleteUser = useDeleteUser();

  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Delete ${user.email}?`}
      /*
       * Three sentences because a soft delete is three facts, and the staff
       * dialog's "this cannot be undone" would be a lie about every one of
       * them (ADR-0028): the row survives so future order history still
       * resolves, the address is released by a partial unique index so the same
       * person can register again, and there is no restore endpoint in v1 —
       * precisely *because* the address may be live on another row by then.
       * Copy is per-call for exactly this reason; the frame is shared, the
       * sentences are not.
       */
      description="The account is kept and marked deleted, and every session ends. It cannot sign in, and admin edits are refused. The email address becomes available to register again — there is no undo."
      confirmLabel="Delete"
      destructive
      isPending={deleteUser.isPending}
      onConfirm={() => {
        deleteUser.mutate(user.id, { onSuccess: onClose });
      }}
    />
  );
};

export const RevokeUserSessionsDialog = ({
  user,
  onClose,
}: {
  readonly user: UserResource;
  readonly onClose: () => void;
}) => {
  const revokeSessions = useRevokeUserSessions();

  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Sign ${user.email} out everywhere?`}
      description="Every session of this account ends immediately. The account itself is unchanged and they can sign in again."
      confirmLabel="Sign out everywhere"
      isPending={revokeSessions.isPending}
      onConfirm={() => {
        revokeSessions.mutate(user.id, { onSuccess: onClose });
      }}
    />
  );
};
