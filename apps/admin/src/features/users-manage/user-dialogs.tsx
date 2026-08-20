import { ResetUserPasswordDialog } from "./reset-user-password-dialog";
import type { UserAction } from "./types";
import {
  BulkDeleteUsersDialog,
  DeleteUserDialog,
  RevokeUserSessionsDialog,
} from "./user-confirm-dialogs";

/**
 * Whichever ephemeral dialog the current action names, and nothing when there
 * is none.
 *
 * One switch over one union, so the page holds a single `useState` and "two
 * dialogs open at once" is not a state this app can reach. Mounting only the
 * active one is also what makes each `useForm` start fresh per opening.
 *
 * Since `D4.2` this covers only what ADR-0040 keeps out of the URL; create and
 * edit are routes, and the router is their invariant.
 */
export const UserDialogs = ({
  action,
  onClose,
}: {
  readonly action: UserAction | null;
  readonly onClose: () => void;
}) => {
  if (action === null) return null;

  switch (action.kind) {
    case "reset-password":
      return <ResetUserPasswordDialog user={action.user} onClose={onClose} />;
    case "revoke-sessions":
      return <RevokeUserSessionsDialog user={action.user} onClose={onClose} />;
    case "delete":
      return <DeleteUserDialog user={action.user} onClose={onClose} />;
    case "bulk-delete":
      return (
        <BulkDeleteUsersDialog
          ids={action.ids}
          rows={action.rows}
          onSettled={action.onSettled}
          onClose={onClose}
        />
      );
  }
};
