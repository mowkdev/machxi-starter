import type { UserResource } from "@repo/contracts";

/**
 * What the operator has asked to do, if anything.
 *
 * The same shape `staff-manage` uses, and not shared with it: ADR-0032 allows
 * no sideways imports between features, and the two unions are typed on
 * different resources anyway. Where the two features genuinely share
 * machinery — the dialog frame, the confirm — it lives in `shared`, which is
 * the boundary doing its job rather than a duplication to fix.
 */
export type UserAction =
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly user: UserResource }
  | { readonly kind: "reset-password"; readonly user: UserResource }
  | { readonly kind: "revoke-sessions"; readonly user: UserResource }
  | { readonly kind: "delete"; readonly user: UserResource };

/** How a page asks for an action; `null` closes whatever is open. */
export type UserActionHandler = (action: UserAction | null) => void;
