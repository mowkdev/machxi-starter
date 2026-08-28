import type { GridCapabilities } from "@repo/resource";

import type { CanFn } from "./can";

/**
 * ADR-0038's capabilities ∧ ADR-0042's `can`, in one place (ADR-0042
 * §It composes with ADR-0038's capabilities).
 *
 * **Two different questions, both answered before an affordance renders.** A
 * capability says *this surface offers the action*; `can()` says *this
 * operator's role may perform it*. This narrows the first by the second, so
 * neither of ADR-0038's two readers — `AppGrid` for the toolbar and the
 * checkbox column, the feature's row-action hook for the menu — has to know
 * about the other, and the menu's Delete and the toolbar's bulk Delete cannot
 * disagree about what this operator sees.
 *
 * **It is a narrowing of the block rather than an `&&` at each button** because
 * `shared/grid` must not learn a resource's name. A grid that called `can`
 * itself would need to be told which resource it is showing, which is precisely
 * the domain knowledge ADR-0035 keeps out of `shared/grid` and ADR-0032 keeps
 * out of `shared` at all. Narrowing above the grid leaves `AppGrid` ignorant.
 *
 * **`canEdit` is deliberately not narrowed, and neither is anything the row
 * menu reaches for during an incident.** Three of the six actions in the policy
 * table are containment controls — `revokeSessions` ends a compromised session,
 * `setPassword` takes a stolen credential away, and an `update` that sets
 * `status: "disabled"` stops the account entirely — and hiding one of those is
 * worse than showing it: a hidden control is silent, with no message and
 * nothing to escalate with, where a visible one that answers `403` tells an
 * operator the control exists and that they need somebody who may use it. As
 * "edit this person's name" `update` is discretionary; as "set their status to
 * disabled" it is the containment control, and today the only route to the
 * second is the same edit form. The day disabling gets an affordance of its own
 * is the day `canEdit` can be reconsidered, and this paragraph is the note to
 * reconsider it from.
 *
 * That leaves `create` and `delete` as the flags `can()` actually hides.
 * Deletion is on this side deliberately: it is destructive rather than
 * containing, and containment has two better instruments that stay permanently
 * visible, so an operator who cannot delete has lost nothing they needed in a
 * hurry.
 *
 * `undefined` in, `undefined` out — a resource that declares no capabilities
 * gets the safe default, a plain read-only grid, and there is nothing to
 * narrow.
 */
export const allowedCapabilities = <TResource extends string>(
  capabilities: GridCapabilities | undefined,
  /*
   * **`CanFn<"create" | "delete", …>`, not the caller's whole action union**
   * (`D9.6`). Those are the only two questions this narrowing asks, and naming
   * them here is what lets the function be generic without a type parameter
   * for the vocabulary: a `CanFn` over a *wider* union is assignable to this
   * one, because a function that accepts every action accepts these two. The
   * signature therefore states the requirement rather than inheriting it.
   */
  canFn: CanFn<"create" | "delete", TResource>,
  resource: TResource,
): GridCapabilities | undefined => {
  if (capabilities === undefined) return undefined;

  /*
   * Bulk delete narrows on `delete`, not on a bulk action of its own: the
   * fan-out calls the same `DELETE /:id` endpoint N times (ADR-0038), so there
   * is one permission question and one answer. Getting this wrong is not
   * cosmetic — ADR-0042 §The cost records that an offered-but-refused bulk
   * delete spends N requests against the global `300 / 15 min / IP` budget, so
   * an operator can rate-limit themselves out of the panel with a control they
   * were never allowed to use.
   */
  const mayDelete = canFn("delete", resource);

  /*
   * Every key named, rather than `...capabilities` with three overrides.
   *
   * The spread reads better and quietly widens what this returns: the pages
   * pass `config.grid`, which is a `GridConfig` — `GridCapabilities` plus
   * ADR-0040's `editSurface` — so a spread copies a routing decision into the
   * object handed to `AppGrid`'s `capabilities` prop. The type says the grid
   * cannot see it; the runtime value would say otherwise, and "AppGrid never
   * learns which shell this resource edits in" would be true only until
   * somebody read the prop at runtime. Naming the keys makes the value match
   * the claim, and a capability added to the block is then a compile error here
   * rather than a silent pass-through.
   */
  return {
    selectable: capabilities.selectable === true,
    canCreate: capabilities.canCreate === true && canFn("create", resource),
    canEdit: capabilities.canEdit === true,
    canDelete: capabilities.canDelete === true && mayDelete,
    canBulkDelete: capabilities.canBulkDelete === true && mayDelete,
    ...(capabilities.pageSizes === undefined
      ? {}
      : { pageSizes: capabilities.pageSizes }),
  };
};
