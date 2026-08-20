import { createAppFormInput } from "@/shared/form/app-form-input";
import type { FieldConfigMap } from "@/shared/resource/types";

/**
 * The profile's form fields, declared once (ADR-0035).
 *
 * **A `FieldConfigMap`, not a `ResourceConfig`, and the omission is the
 * decision.** ADR-0035 pairs columns with fields so that a resource's table and
 * its forms cannot disagree about what the resource is — an argument that
 * presumes a table. `/admin/profile` is a singleton: there is no list endpoint,
 * no `:id`, and no grid this could ever feed, so a `columns: {}` here would not
 * be a resource declaring itself, it would be a config claiming an empty table
 * exists. `AppFormProvider` is keyed on a field map rather than on a
 * `ResourceConfig` (ADR-0035, amended D3.7), so the machinery needs nothing
 * else, and what this map owes is what every map owes: the config-versus-
 * contract test in `__tests__/profile.config.test.ts`.
 *
 * Two fields, because `updateStaffProfileBody` has two. Every other thing an
 * operator can see about their account — email, roles, status — is read-only
 * here and displayed by the page rather than declared as a field: the contract
 * omits them deliberately (ADR-0027 §Contracts, amended D2.3), and a field with
 * nothing to submit to would be the config telling a different story from the
 * endpoint.
 *
 * Neither is `nullable`: `staff.first_name` and `staff.last_name` are `NOT
 * NULL` (ADR-0017), so unlike the user profile's names there is no "clear it"
 * request to express, and an emptied box is a validation error rather than a
 * `null`.
 */
export const profileFields = {
  firstName: { label: "First name", component: "input" },
  lastName: { label: "Last name", component: "input" },
} as const satisfies FieldConfigMap;

/**
 * The typed input for the profile's fields (ADR-0035).
 *
 * As with `StaffFormInput`, this is what makes `fieldName="frstName"` a compile
 * error instead of a control that silently never renders.
 */
export const ProfileFormInput = createAppFormInput(profileFields);
