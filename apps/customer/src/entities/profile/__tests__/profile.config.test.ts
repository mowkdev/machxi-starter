import { updateProfileBody } from "@repo/contracts";
import { describe, expect, it } from "vitest";

import { fieldsForVariant } from "@/shared/resource/config";
import type { FieldConfigMap } from "@/shared/resource/types";

import { profileFields } from "../profile.config";

/**
 * The profile's field map against `updateProfileBody` (ADR-0035 §Consequences,
 * ADR-0036).
 *
 * The debt every config carries, and on this segment it pays for something
 * sharper than a typo. `PATCH /user/profile` has no `authorize` and needs none
 * (ADR-0019 §3): the guard *is* the schema having no `roles` and no `status` to
 * send, so a customer cannot promote or re-enable their own account through
 * their own profile. A field this config grew for one of them would render a
 * control whose submit the schema refuses — which is the guard holding, but it
 * would also be this app offering an escalation and calling it a form.
 */

const fields: FieldConfigMap = profileFields;

describe("the profile form config against updateProfileBody", () => {
  it("submits exactly the fields it declares", () => {
    const names = fieldsForVariant(fields, "edit").map(([name]) => name);

    const parsed = updateProfileBody.safeParse(
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
        updateProfileBody.safeParse({ firstName: "Cara", [forbidden]: "x" })
          .success,
      ).toBe(false);
    }
  });

  it("refuses an emptied name, though the contract would accept a cleared one", () => {
    /*
     * The asymmetry `profile.config.ts` writes down, pinned. `users.first_name`
     * is nullable (ADR-0017) so `null` is a legal request here — unlike the
     * staff mirror, where both spellings are refused — but `""` is not, and a
     * text box submits `""`. So an emptied field is a validation message rather
     * than a silently cleared name, and the day this app grows a real "remove
     * my surname" control is the day the second assertion changes.
     */
    expect(updateProfileBody.safeParse({ firstName: "" }).success).toBe(false);
    expect(updateProfileBody.safeParse({ firstName: null }).success).toBe(true);
  });

  it("refuses a submit that changed nothing", () => {
    // What `dirtyValuesOf` in the form is protecting: an empty body is the
    // contract's "provide at least one field", and the form's disabled button
    // is the polite version of this refusal.
    expect(updateProfileBody.safeParse({}).success).toBe(false);
  });
});
