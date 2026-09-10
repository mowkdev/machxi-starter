import type { StaffResource } from "@repo/contracts";

/**
 * What the operator has asked to do, if anything — of the things that must
 * **not** be addressable.
 *
 * One discriminated union rather than three booleans, so "the delete confirm is
 * open and so is the reset-password ceremony" is not a state this app can
 * reach. The page holds exactly one of these; `StaffDialogs` renders whichever
 * it names.
 *
 * **`create` and `edit` left at `D4.2`** (ADR-0040), and the line they crossed
 * is worth keeping in view because the next resource will have to draw it too:
 * a surface whose content is *a record being composed* is addressable state —
 * it earns a URL, survives a reload, closes on Back, and can be sent to a
 * colleague. A surface whose content is *consent to a destructive act* must not
 * be: a URL that reopens "confirm delete" on load is a bookmarked, history-
 * restorable destruction prompt sitting primed over a row nobody has looked at.
 * The reset-password ceremony stays for a related reason — it is a credential
 * flow whose variables ADR-0034 already treats specially, and nothing about it
 * wants to be shareable.
 *
 * The subject travels with the action rather than being looked up again,
 * because the grid already has the row — and a confirm that re-fetched it would
 * be able to disagree with the row the operator clicked.
 */
export type StaffAction =
  | { readonly kind: "reset-password"; readonly staff: StaffResource }
  /**
   * The invitation resend (`D18.11`, ADR-0071 §8). Ephemeral like every other
   * entry here, and for the ordinary reason: a URL that reopened it on load
   * would be a bookmarked prompt to mail somebody, primed over a row nobody
   * has looked at.
   */
  | { readonly kind: "resend-invitation"; readonly staff: StaffResource }
  | { readonly kind: "revoke-sessions"; readonly staff: StaffResource }
  | { readonly kind: "delete"; readonly staff: StaffResource }
  /**
   * The bulk confirm (`D4.3`, ADR-0038). Ephemeral for the same reason the
   * single delete is, and more so: a URL that reopened "delete these seven" on
   * load would be a bookmarked, history-restorable destruction prompt primed
   * over rows nobody has looked at.
   *
   * It carries three things because a bulk action needs all three and no other
   * shape has them together: the selected `ids`, which may name rows no longer
   * on screen; the `rows` the grid currently holds, so a refusal can be
   * reported by address rather than by uuid; and `onSettled`, which is the
   * grid's own `clearSelection` — the selection has to end when the fan-out
   * does, and the state that holds it lives inside `AppGrid`.
   */
  | {
      readonly kind: "bulk-delete";
      readonly ids: readonly string[];
      readonly rows: readonly StaffResource[];
      readonly onSettled: () => void;
    };

/** How a page asks for an action; `null` closes whatever is open. */
export type StaffActionHandler = (action: StaffAction | null) => void;
