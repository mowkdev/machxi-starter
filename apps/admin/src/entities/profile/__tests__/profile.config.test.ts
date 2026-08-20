import { updateStaffProfileBody } from "@repo/contracts";
import { describe, expect, it } from "vitest";

import { fieldsForVariant } from "@/shared/resource/config";
import type { FieldConfigMap } from "@/shared/resource/types";

import { profileFields } from "../profile.config";

/**
 * The profile's field map against `updateStaffProfileBody` (ADR-0035
 * §Consequences, ADR-0036).
 *
 * The same debt every config carries, and here it is paying for something
 * sharper than a typo. `PATCH /admin/profile` is mounted **without**
 * `authorize` (ADR-0019 §3, ADR-0027): the guard is that the schema has no
 * `roles`, no `status` and no `email` to send, so an `editor` cannot promote
 * itself through its own profile. A field this config grew for one of them
 * would render a control whose submit the schema refuses — which is the guard
 * holding, but it would also be this app offering an escalation and calling it
 * a form. The negative control below is that claim, tested.
 */

const fields: FieldConfigMap = profileFields;

describe("the profile form config against updateStaffProfileBody", () => {
  it("submits exactly the fields it declares", () => {
    const names = fieldsForVariant(fields, "edit").map(([name]) => name);

    const parsed = updateStaffProfileBody.safeParse(
      Object.fromEntries(names.map((name) => [name, "Sample"] as const)),
    );

    // A `strictObject`, so one parse proves both directions: no unknown key,
    // and nothing the endpoint needs left unrendered.
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("declares no field the endpoint would refuse as an escalation", () => {
    expect(Object.keys(fields)).toEqual(["firstName", "lastName"]);

    for (const forbidden of ["roles", "status", "email"]) {
      expect(fields[forbidden]).toBeUndefined();
      expect(
        updateStaffProfileBody.safeParse({ firstName: "Ada", [forbidden]: "x" })
          .success,
      ).toBe(false);
    }
  });

  it("refuses an emptied name rather than clearing it", () => {
    /*
     * `staff.first_name` is `NOT NULL` (ADR-0017), which is why no field here
     * is `nullable` and why the adapter must not map an emptied box to `null`
     * the way the users form does. Both spellings of "blank" are refused.
     */
    expect(updateStaffProfileBody.safeParse({ firstName: "" }).success).toBe(
      false,
    );
    expect(updateStaffProfileBody.safeParse({ firstName: null }).success).toBe(
      false,
    );
  });

  it("refuses a submit that changed nothing", () => {
    // What `dirtyValuesOf` in the form is protecting: an empty body is the
    // contract's "provide at least one field", and the form's disabled button
    // is the polite version of this refusal.
    expect(updateStaffProfileBody.safeParse({}).success).toBe(false);
  });
});
