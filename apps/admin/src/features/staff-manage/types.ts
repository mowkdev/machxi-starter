import type { StaffResource } from "@repo/contracts";

/**
 * What the operator has asked to do, if anything.
 *
 * One discriminated union rather than five booleans, so "the edit dialog is
 * open and so is the delete confirm" is not a state this app can reach. The
 * page holds exactly one of these; `StaffDialogs` renders whichever it names.
 *
 * The subject travels with the action rather than being looked up again,
 * because the grid already has the row — and a dialog that re-fetched it would
 * be able to disagree with the row the operator clicked.
 */
export type StaffAction =
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly staff: StaffResource }
  | { readonly kind: "reset-password"; readonly staff: StaffResource }
  | { readonly kind: "revoke-sessions"; readonly staff: StaffResource }
  | { readonly kind: "delete"; readonly staff: StaffResource };

/** How a page asks for an action; `null` closes whatever is open. */
export type StaffActionHandler = (action: StaffAction | null) => void;
