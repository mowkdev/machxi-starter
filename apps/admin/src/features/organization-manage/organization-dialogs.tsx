import {
  BulkDeleteOrganizationsDialog,
  DeleteOrganizationDialog,
} from "./organization-confirm-dialogs";
import type { OrganizationAction } from "./types";

/**
 * Whichever ephemeral dialog the current action names, and nothing when there
 * is none.
 *
 * One switch over one union, so the page holds a single `useState` and the "two
 * dialogs open at once" state does not exist. Mounting only the active one is
 * also what makes each `useForm` start fresh per opening: a ceremony that kept
 * its values from the last row it acted on is the bug this shape rules out
 * rather than remembers to reset.
 *
 * This covers only what ADR-0040 keeps out of the URL. Create and edit are
 * routes, and the router is their invariant: one URL matches one child.
 */
export const OrganizationDialogs = ({
  action,
  onClose,
}: {
  readonly action: OrganizationAction | null;
  readonly onClose: () => void;
}) => {
  if (action === null) return null;

  switch (action.kind) {
    case "delete":
      return (
        <DeleteOrganizationDialog
          organization={action.organization}
          onClose={onClose}
        />
      );
    case "bulk-delete":
      return (
        <BulkDeleteOrganizationsDialog
          ids={action.ids}
          rows={action.rows}
          onSettled={action.onSettled}
          onClose={onClose}
        />
      );
  }
};
