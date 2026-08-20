import { CreateUserDialog } from "./create-user-dialog";
import { EditUserDialog } from "./edit-user-dialog";
import { ResetUserPasswordDialog } from "./reset-user-password-dialog";
import {
  DeleteUserDialog,
  RevokeUserSessionsDialog,
} from "./user-confirm-dialogs";
import type { UserAction } from "./types";

/**
 * Whichever dialog the current action names, and nothing when there is none.
 *
 * One switch over one union, so the page holds a single `useState` and "two
 * dialogs open at once" is not a state this app can reach. Mounting only the
 * active one is also what makes each dialog's `useForm` and `useUser` start
 * fresh per opening.
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
    case "create":
      return <CreateUserDialog open onClose={onClose} />;
    case "edit":
      return <EditUserDialog user={action.user} onClose={onClose} />;
    case "reset-password":
      return <ResetUserPasswordDialog user={action.user} onClose={onClose} />;
    case "revoke-sessions":
      return <RevokeUserSessionsDialog user={action.user} onClose={onClose} />;
    case "delete":
      return <DeleteUserDialog user={action.user} onClose={onClose} />;
  }
};
