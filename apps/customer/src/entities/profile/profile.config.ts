import { createAppFormInput } from "@/shared/form/app-form-input";
import type { FieldConfigMap } from "@/shared/resource/types";

/**
 * The profile's form fields, declared once (ADR-0035).
 *
 * **A `FieldConfigMap`, not a `ResourceConfig`, and the omission is the
 * decision.** ADR-0035 pairs columns with fields so that a resource's table and
 * its forms cannot disagree about what the resource is — an argument that
 * presumes a table. `/user/profile` is a singleton: there is no list endpoint,
 * no `:id`, and — ADR-0055 §3 — no grid anywhere in this app, so a `columns: {}`
 * here would not be a resource declaring itself, it would be a config claiming
 * an empty table exists. `AppFormProvider` is keyed on a field map rather than
 * on a `ResourceConfig`, so the machinery needs nothing else.
 *
 * Two fields, because `updateProfileBody` has two. Everything else a customer
 * can see about their account — email, when they joined, when they last signed
 * in — is read-only here and displayed by the page rather than declared as a
 * field: the contract omits them deliberately, and a field with nothing to
 * submit to would be the config telling a different story from the endpoint.
 *
 * **Neither is marked `nullable`, and unlike the admin's that is not because
 * the columns are `NOT NULL`.** `users.first_name` and `users.last_name` *are*
 * nullable (ADR-0017) and `updateProfileBody` accepts `null` on both, so
 * "clear it" is a legal request on this segment. What has no surface for it is
 * this form: an emptied text box submits `""`, `nameSchema` refuses that, and
 * the customer gets a validation message rather than a silently cleared name.
 * Offering a real "remove my surname" would be a control of its own, and
 * inventing one here would be this config deciding a product question. The
 * asymmetry with the contract is deliberate and this paragraph is where it is
 * written down.
 */
export const profileFields = {
  firstName: { label: "profile:fields.firstName.label", component: "input" },
  lastName: { label: "profile:fields.lastName.label", component: "input" },
} as const satisfies FieldConfigMap;

/**
 * The typed input for the profile's fields (ADR-0035).
 *
 * This is what makes `fieldName="frstName"` a compile error instead of a
 * control that silently never renders.
 */
export const ProfileFormInput = createAppFormInput(profileFields);
