import type { UserResource } from "@repo/contracts";

import { useDeleteUser, useRevokeUserSessions } from "@/entities/user";
import type { BulkTarget } from "@/shared/api/bulk-outcome";
import { useT } from "@/shared/i18n";
import { ConfirmDialog } from "@/shared/ui";

import { useBulkDeleteUsers } from "./use-bulk-delete-users";

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
  const { t } = useT("users");
  const deleteUser = useDeleteUser();

  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("delete.title", { email: user.email })}
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
      description={t("delete.description")}
      confirmLabel={t("delete.confirm")}
      destructive
      isPending={deleteUser.isPending}
      onConfirm={() => {
        deleteUser.mutate(user.id, { onSuccess: onClose });
      }}
    />
  );
};

/**
 * The bulk confirm (`D4.3`, ADR-0038) — and its copy is the **soft**-delete
 * sentence, which is the whole reason this is not shared with the staff one.
 *
 * ADR-0028 makes the two populations asymmetric on purpose: a customer record
 * is referenced by future order history so the row survives, while a staff
 * member is a directory entry that goes outright. "This cannot be undone" is
 * literally true there and would be wrong here in the direction that matters.
 */
export const BulkDeleteUsersDialog = ({
  ids,
  rows,
  onSettled,
  onClose,
}: {
  readonly ids: readonly string[];
  readonly rows: readonly UserResource[];
  readonly onSettled: () => void;
  readonly onClose: () => void;
}) => {
  const { t } = useT("users");
  const bulkDelete = useBulkDeleteUsers();

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
      title={t("bulkDelete.title", { count: ids.length })}
      description={t("bulkDelete.description")}
      confirmLabel={t("bulkDelete.confirm")}
      destructive
      isPending={bulkDelete.isPending}
      onConfirm={() => {
        bulkDelete.mutate(targets, {
          onSuccess: () => {
            onSettled();
            onClose();
          },
        });
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
  const { t } = useT("users");
  const revokeSessions = useRevokeUserSessions();

  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("revokeSessions.title", { email: user.email })}
      description={t("revokeSessions.description")}
      confirmLabel={t("revokeSessions.confirm")}
      isPending={revokeSessions.isPending}
      onConfirm={() => {
        revokeSessions.mutate(user.id, { onSuccess: onClose });
      }}
    />
  );
};
