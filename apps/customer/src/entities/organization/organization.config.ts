import {
  INVITABLE_ROLES,
  type CreateInvitationBody,
  type CreateOrganizationBody,
  type UpdateOrganizationBody,
} from "@repo/contracts";

import { createAppFormInput } from "@/shared/form/app-form-input";
import { dynamicKey } from "@/shared/i18n";
import type { FieldConfigMap } from "@/shared/resource/types";

/**
 * The organization's form fields, declared once (ADR-0035, ADR-0063 §1).
 *
 * **A `FieldConfigMap`, not a `ResourceConfig`**, for the reason the profile's
 * is one: a `ResourceConfig` pairs columns with fields so a resource's table and
 * its forms cannot disagree, and this app draws no table (ADR-0055 §3). A
 * `columns: {}` here would be a config claiming an empty grid exists.
 *
 * **Typed over the intersection of both bodies**, which is what makes the one
 * map serve the create dialog and the settings form at once: `keyof (A & B)` is
 * `keyof A | keyof B`, so a field the endpoints dropped is a compile error
 * rather than a control the API answers with a `VALIDATION_ERROR`.
 *
 * Two fields, because name and slug are the whole of what an organization has
 * (ADR-0067 §7). `kind` is not here and never will be in v1: it is set at
 * creation and a personal organization cannot be turned into a team one.
 */
export const organizationFields = {
  name: { label: "organizations:fields.name.label", component: "input" },
  slug: {
    label: "organizations:fields.slug.label",
    component: "input",
    description: "organizations:fields.slug.description",
  },
} as const satisfies FieldConfigMap<
  CreateOrganizationBody & UpdateOrganizationBody
>;

/**
 * The typed input for those fields — `fieldName="nmae"` is a compile error
 * rather than a control that silently never renders (ADR-0035).
 */
export const OrganizationFormInput = createAppFormInput(organizationFields);

/**
 * The invitation's fields (ADR-0067 §2).
 *
 * Their own map rather than fields on the organization's, and the endpoint says
 * why: an invitation is a sub-resource with its own row and its own lifetime,
 * not an attribute of the tenant — the same line `changePasswordFields` sits on
 * with respect to the profile.
 *
 * **The role options are `INVITABLE_ROLES`, not `ORGANIZATION_ROLES`**, and the
 * narrowing is the contract's rather than this config's (`@repo/contracts`):
 * `owner` is not invitable, because ownership is granted by an owner to an
 * existing member. Mapping the contract's own tuple is what keeps that true
 * when the tuple changes — a hand-written pair here would go on offering a role
 * the endpoint had stopped accepting.
 *
 * The labels resolve into this app's organizations catalogue rather than
 * through `common:options.<value>`: that block is the admin's, following a
 * `ResourceConfig` this app does not have, and the two words are already
 * written for the members table. `dynamicKey` is the cast that says so — the
 * scan cannot see a composed key, so `scripts/i18n.mjs` carries the prefix in
 * its `DYNAMIC` list beside the members table that composes the same one.
 */
export const invitationFields = {
  email: {
    label: "organizations:invitations.fields.email.label",
    component: "input",
    description: "organizations:invitations.fields.email.description",
    props: { type: "email", autoComplete: "off" },
  },
  role: {
    label: "organizations:invitations.fields.role.label",
    component: "select",
    initialValue: "member",
    options: INVITABLE_ROLES.map((role) => ({
      value: role,
      label: dynamicKey(`organizations:members.role.${role}`),
    })),
  },
} as const satisfies FieldConfigMap<CreateInvitationBody>;

export const InvitationFormInput = createAppFormInput(invitationFields);
