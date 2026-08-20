import { CreateStaffDialog } from "./create-staff-dialog";
import { EditStaffDialog } from "./edit-staff-dialog";
import { ResetStaffPasswordDialog } from "./reset-staff-password-dialog";
import {
  DeleteStaffDialog,
  RevokeStaffSessionsDialog,
} from "./staff-confirm-dialogs";
import type { StaffAction } from "./types";

/**
 * Whichever dialog the current action names, and nothing when there is none.
 *
 * One switch over one union, so the page holds a single `useState` and the
 * "two dialogs open at once" state does not exist. Mounting only the active one
 * is also what makes each dialog's `useForm` and `useStaff` start fresh per
 * opening: a form that kept its values from the last staff member it edited is
 * the bug this shape rules out rather than remembers to reset.
 */
export const StaffDialogs = ({
  action,
  onClose,
}: {
  readonly action: StaffAction | null;
  readonly onClose: () => void;
}) => {
  if (action === null) return null;

  switch (action.kind) {
    case "create":
      return <CreateStaffDialog open onClose={onClose} />;
    case "edit":
      return <EditStaffDialog staff={action.staff} onClose={onClose} />;
    case "reset-password":
      return (
        <ResetStaffPasswordDialog staff={action.staff} onClose={onClose} />
      );
    case "revoke-sessions":
      return (
        <RevokeStaffSessionsDialog staff={action.staff} onClose={onClose} />
      );
    case "delete":
      return <DeleteStaffDialog staff={action.staff} onClose={onClose} />;
  }
};
