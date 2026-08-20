import { describe, expect, it } from "vitest";

import type { GridCapabilities } from "@/shared/resource/types";

import { can } from "../can";
import { allowedCapabilities } from "../capabilities";
import type { CanFn } from "../can";

/**
 * The conjunction of ADR-0038's capabilities and ADR-0042's `can` (ADR-0036).
 *
 * The interesting assertions here are the **negative** ones — the flags this
 * deliberately leaves alone. A later "tidy-up" that narrowed `canEdit` for
 * symmetry would look like a consistency fix and would hide a containment
 * control, so the carve-out is pinned rather than described.
 */

const FULL: GridCapabilities = {
  selectable: true,
  canCreate: true,
  canEdit: true,
  canDelete: true,
  canBulkDelete: true,
};

/** A predicate that refuses exactly the writes `/admin/users` refuses a manager. */
const asManager: CanFn = (action, resource) =>
  can(
    {
      kind: "staff",
      id: "0198c1f0-0000-7000-8000-0000000000aa",
      email: "mo@machxi.local",
      firstName: "Mo",
      lastName: "Manager",
      roles: ["manager"],
    },
    action,
    resource,
  );

const asAdmin: CanFn = () => true;

describe("allowedCapabilities", () => {
  it("hides create and delete where the role may not perform them", () => {
    const narrowed = allowedCapabilities(FULL, asManager, "users");

    expect(narrowed?.canCreate).toBe(false);
    expect(narrowed?.canDelete).toBe(false);
  });

  it("narrows bulk delete on the same answer as delete, because it is the same endpoint", () => {
    /*
     * Not cosmetic. The fan-out spends one request per selected row against the
     * global `300 / 15 min / IP` budget (ADR-0020), so a bulk delete offered to
     * an operator who may not delete lets them rate-limit themselves out of the
     * panel with a control they were never allowed to use.
     */
    expect(allowedCapabilities(FULL, asManager, "users")?.canBulkDelete).toBe(
      false,
    );
    expect(allowedCapabilities(FULL, asAdmin, "users")?.canBulkDelete).toBe(
      true,
    );
  });

  it("never narrows canEdit, because the disable path runs through it", () => {
    /*
     * ADR-0042 §Containment controls. As "edit this person's name" `update` is
     * discretionary; as "set their status to disabled" it is the containment
     * control, and today the only route to the second is the same edit form. A
     * rule that hid the form would hide the containment control by accident.
     */
    expect(allowedCapabilities(FULL, asManager, "users")?.canEdit).toBe(true);
    expect(can(null, "update", "users")).toBe(false);
  });

  it("leaves selectable and pageSizes alone — they are not permissions", () => {
    const narrowed = allowedCapabilities(
      { ...FULL, pageSizes: [10, 20] },
      asManager,
      "users",
    );

    expect(narrowed?.selectable).toBe(true);
    expect(narrowed?.pageSizes).toEqual([10, 20]);
  });

  it("gives a resource that declares nothing the safe default", () => {
    // No capabilities in, none out: a plain read-only grid, and nothing to
    // narrow (ADR-0038 §Consequences).
    expect(allowedCapabilities(undefined, asAdmin, "staff")).toBeUndefined();
  });

  it("cannot turn a capability on that the config left off", () => {
    // The conjunction only ever removes. A screen whose resource does not offer
    // deletion does not acquire it from a role that could have performed one.
    const narrowed = allowedCapabilities(
      { selectable: true },
      asAdmin,
      "staff",
    );

    expect(narrowed?.canDelete).toBe(false);
    expect(narrowed?.canCreate).toBe(false);
  });
});
