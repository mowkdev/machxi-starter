import type { OrganizationResource } from "@repo/contracts";

/**
 * What the operator has asked to do, if anything — of the things that must
 * **not** be addressable.
 *
 * One discriminated union rather than a boolean each, so "the delete confirm is
 * open and so is the bulk one" is not a state this app can reach. The page holds
 * exactly one of these; `OrganizationDialogs` renders whichever it names.
 *
 * **Create and edit are not here, and that line is the one to keep in view.** A
 * surface whose content is *a record being composed* is addressable state — it
 * earns a URL, survives a reload, closes on Back, and can be sent to a
 * colleague. A surface whose content is *consent to a destructive act* must not
 * be: a URL that reopens "confirm delete" on load is a bookmarked,
 * history-restorable destruction prompt sitting primed over a row nobody has
 * looked at (ADR-0040).
 *
 * The subject travels with the action rather than being looked up again,
 * because the grid already has the row — and a confirm that re-fetched it would
 * be able to disagree with the row the operator clicked.
 */
export type OrganizationAction =
  | { readonly kind: "delete"; readonly organization: OrganizationResource }
  /**
   * The bulk confirm (ADR-0038). It carries three things because a bulk action
   * needs all three: the selected `ids`, which may name rows no longer on
   * screen; the `rows` the grid currently holds, so a refusal can be reported
   * by address rather than by uuid; and `onSettled`, which is the grid's own
   * `clearSelection` — the selection has to end when the fan-out does, and the
   * state that holds it lives inside `AppGrid`.
   */
  | {
      readonly kind: "bulk-delete";
      readonly ids: readonly string[];
      readonly rows: readonly OrganizationResource[];
      readonly onSettled: () => void;
    };

/** How a page asks for an action; `null` closes whatever is open. */
export type OrganizationActionHandler = (
  action: OrganizationAction | null,
) => void;
