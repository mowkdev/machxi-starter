import { ResetStaffPasswordDialog } from "./reset-staff-password-dialog";
import {
  DeleteStaffDialog,
  RevokeStaffSessionsDialog,
} from "./staff-confirm-dialogs";
import type { StaffAction } from "./types";

/**
 * Whichever ephemeral dialog the current action names, and nothing when there
 * is none.
 *
 * One switch over one union, so the page holds a single `useState` and the
 * "two dialogs open at once" state does not exist. Mounting only the active one
 * is also what makes each `useForm` start fresh per opening: a ceremony that
 * kept its values from the last account it acted on is the bug this shape rules
 * out rather than remembers to reset.
 *
 * Since `D4.2` this covers only what ADR-0040 keeps out of the URL — the two
 * confirms and the password ceremony. Create and edit are routes now, and the
 * router is their invariant: one URL matches one child.
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
