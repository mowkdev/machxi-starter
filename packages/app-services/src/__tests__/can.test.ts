import type {
  StaffPrincipalResource,
  StaffRole,
  UserPrincipalResource,
} from "@repo/contracts";
import { describe, expect, it } from "vitest";

import { allowedCapabilities, can, type ResourcePolicy } from "..";

/**
 * The predicate, asked what can be asked with no app mounted (`D9.6`,
 * ADR-0042, ADR-0036).
 *
 * **`apps/admin`'s two suites did not move and should not.**
 * `policy.test.ts` is a transcription check against that API's `authorize(`
 * calls and `capabilities.test.ts` drives the narrowing through that app's
 * resources; both are about data this package deliberately does not hold. What
 * is left over is the rule underneath the table, and it is exactly the part
 * that had no test of its own before the split: the three answers `can` gives
 * before it ever reads a row, and the fact that it gives them for *any*
 * vocabulary rather than for `"staff" | "users"`.
 *
 * The fixture is therefore deliberately not this repo's: `widget` and
 * `archive` are names no app here uses, so a case that passes can only have
 * passed generically.
 */

type Resource = "widget" | "gadget";
type Action = "read" | "create" | "delete" | "archive";

const POLICY: ResourcePolicy<Resource, Action> = {
  widget: { read: ["manager"], create: ["admin"], delete: ["admin"] },
  /*
   * `archive` is absent from both rows and `gadget` carries only `read`, which
   * is the deny-by-default half of ADR-0019 §Rules expressed as a *hole* in the
   * data rather than as an entry. A table that had to spell out every denial
   * would be a table nobody could keep in step with the routers.
   */
  gadget: { read: ["admin", "manager"] },
};

/*
 * No cast in either fixture: the return annotation is what checks the shape,
 * and a cast here would swallow exactly the drift these principals exist to
 * follow. `@repo/contracts` is the one declaration of both (ADR-0023).
 */
const staff = (...roles: StaffRole[]): StaffPrincipalResource => ({
  kind: "staff",
  id: "00000000-0000-4000-8000-000000000001",
  email: "someone@example.test",
  firstName: "Some",
  lastName: "One",
  roles,
});

const customer = (): UserPrincipalResource => ({
  kind: "user",
  id: "00000000-0000-4000-8000-000000000002",
  email: "customer@example.test",
  firstName: "Cus",
  lastName: "Tomer",
  roles: ["customer"],
});

describe("can", () => {
  it("answers false before the session has resolved", () => {
    // Not "denied" — "not yet known". The rule ADR-0042 leaves behind is that
    // nothing irreversible may be decided on a `can()` in this state.
    expect(can(POLICY, null, "read", "widget")).toBe(false);
  });

  it("answers false for a principal whose population has no staff roles", () => {
    /*
     * In `apps/admin` this branch could not fire: that app's client is pinned
     * to one segment, so its store only ever held a staff principal. A package
     * serves both populations, and this table is keyed by `StaffRole` — a
     * `user` principal has none, so there is nothing to ask and `false` is the
     * whole answer.
     */
    expect(can(POLICY, customer(), "read", "gadget")).toBe(false);
  });

  it("lets super_admin past the table rather than listing it in every row", () => {
    expect(can(POLICY, staff("super_admin"), "archive", "gadget")).toBe(true);
  });

  it("denies an action no row grants, to a role that holds others", () => {
    expect(can(POLICY, staff("admin"), "archive", "widget")).toBe(false);
  });

  it("grants on any one of the principal's roles", () => {
    expect(can(POLICY, staff("editor", "manager"), "read", "widget")).toBe(
      true,
    );
  });

  it("denies where the row names other roles", () => {
    expect(can(POLICY, staff("manager"), "delete", "widget")).toBe(false);
  });
});

describe("allowedCapabilities", () => {
  const canFn = (action: "create" | "delete", resource: Resource) =>
    can(POLICY, staff("manager"), action, resource);

  it("passes undefined through, so a resource with no block stays read-only", () => {
    expect(allowedCapabilities(undefined, canFn, "widget")).toBeUndefined();
  });

  it("narrows create and both deletes, and leaves edit alone", () => {
    /*
     * `canEdit` is deliberately not narrowed: `update` is the containment
     * control that disables an account, and a hidden containment control is
     * worse than a visible one that answers 403 (ADR-0042 §It composes).
     */
    expect(
      allowedCapabilities(
        {
          selectable: true,
          canCreate: true,
          canEdit: true,
          canDelete: true,
          canBulkDelete: true,
        },
        canFn,
        "widget",
      ),
    ).toEqual({
      selectable: true,
      canCreate: false,
      canEdit: true,
      canDelete: false,
      canBulkDelete: false,
    });
  });

  it("names every key, so a routing decision cannot ride along in the result", () => {
    /*
     * The pages pass `config.grid`, which is a `GridConfig` — capabilities plus
     * ADR-0040's `editSurface`. A spread would copy that into the object handed
     * to `AppGrid`'s `capabilities` prop, making "the grid never learns which
     * shell this resource edits in" true only until somebody read the prop at
     * runtime.
     */
    const withExtra = {
      selectable: false,
      canEdit: false,
      editSurface: "drawer",
    } as unknown as Parameters<typeof allowedCapabilities<Resource>>[0];

    expect(allowedCapabilities(withExtra, canFn, "gadget")).not.toHaveProperty(
      "editSurface",
    );
  });
});
