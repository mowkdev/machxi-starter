import type { UserResource } from "@repo/contracts";

/**
 * What the operator has asked to do, if anything — of the things that must
 * **not** be addressable.
 *
 * The same shape `staff-manage` uses, and not shared with it: ADR-0032 allows
 * no sideways imports between features, and the two unions are typed on
 * different resources anyway. Where the two features genuinely share
 * machinery — the form frame, the confirm — it lives in `shared`, which is the
 * boundary doing its job rather than a duplication to fix.
 *
 * **`create` and `edit` left at `D4.2`** for the router (ADR-0040); what stays
 * is what must not be reachable by a link — two destructive confirms and the
 * password ceremony. `staff-manage/types.ts` carries the reasoning, and the
 * fact that both unions shrank the same way is the line being a line rather
 * than a judgement made twice.
 */
export type UserAction =
  | { readonly kind: "reset-password"; readonly user: UserResource }
  | { readonly kind: "revoke-sessions"; readonly user: UserResource }
  | { readonly kind: "delete"; readonly user: UserResource };

/** How a page asks for an action; `null` closes whatever is open. */
export type UserActionHandler = (action: UserAction | null) => void;
