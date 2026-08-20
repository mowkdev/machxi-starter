import { STAFF_ROLES, STAFF_STATUSES, type ErrorCode } from "@repo/contracts";

import { createAppFormInput } from "@/shared/form/app-form-input";
import type { ResourceConfig } from "@/shared/resource/types";

/**
 * The staff resource, declared once (ADR-0035).
 *
 * The first real config, and the thing D3.6's machinery was built to be fed.
 * Columns and fields sit together so the grid and the two forms cannot disagree
 * about what a staff member is: `email` is create-only here because
 * `updateStaffBody` omits it, `status` is edit-only because `createStaffBody`
 * does not take one (ADR-0018 §Staff onboarding creates staff `active`), and
 * both facts are visible in one screen rather than spread over two components.
 *
 * **Every `sortable` and every `filter` below is a claim about
 * `listStaffQuery`**, and the claims are tested rather than trusted — see
 * `__tests__/staff.config.test.ts`, which runs each one through the actual
 * contract schema. A column the API would answer with a `VALIDATION_ERROR` is a
 * red test here, not a toast an operator meets.
 *
 * Three columns the API can order by are deliberately absent as *filters*
 * rather than as columns: `firstName` and `lastName` are not in the endpoint's
 * `filterable` map at all (they are reachable through `q`, which searches email
 * and name), and `roles` is neither sortable nor filterable because
 * `staff_roles` is a join table — the contract says so, and the config says the
 * same thing by having no control there.
 */
export const staffResourceConfig = {
  name: "staff",
  columns: {
    email: {
      header: "Email",
      sortable: true,
      /*
       * `like` and not `eq`: `filterable.email.value` is `emailSchema`, so an
       * `eq` control would reject every partial term an operator types. ADR-0014
       * exempts `like` from the field's value schema — a pattern is not a value
       * of the column's type — and `containsPattern` escapes what was typed
       * before wrapping it, which is the half a UI writing the pattern on the
       * operator's behalf owes them.
       */
      filter: { kind: "text", op: "like", placeholder: "Contains…" },
    },
    firstName: { header: "First name", sortable: true },
    lastName: { header: "Last name", sortable: true },
    roles: { header: "Roles", cellRenderer: "rolesList" },
    status: {
      header: "Status",
      sortable: true,
      cellRenderer: "statusBadge",
      // `eq` rather than the `in` the contract also allows: the control is a
      // single `Select` (D3.6), and declaring `in` would describe a multi-select
      // that does not exist.
      filter: { kind: "enum", op: "eq", options: STAFF_STATUSES },
    },
    lastLoginAt: {
      header: "Last login",
      sortable: true,
      formatter: "dateTime",
      filter: { kind: "dateRange", from: "gte", to: "lte" },
    },
    createdAt: {
      header: "Created",
      sortable: true,
      formatter: "date",
      filter: { kind: "dateRange", from: "gte", to: "lte" },
    },
    actions: { header: "Actions", cellRenderer: "rowActions", align: "end" },
  },
  fields: {
    email: {
      label: "Email",
      component: "input",
      props: { type: "email", autoComplete: "off" },
      variants: ["create"],
    },
    password: {
      label: "Initial password",
      component: "input",
      props: { type: "password", autoComplete: "new-password" },
      /*
       * The operational instruction ADR-0027 rule 4 leaves as the consequence
       * of not building a forced change: an administrator-set password stays
       * valid until its holder changes it, so somebody has to ask them to.
       */
      description:
        "Hand this over out of band and ask them to change it. Nothing forces a change at first sign-in.",
      variants: ["create"],
    },
    firstName: { label: "First name", component: "input", initialValue: "" },
    lastName: { label: "Last name", component: "input", initialValue: "" },
    roles: {
      label: "Roles",
      component: "multiCheckbox",
      options: STAFF_ROLES,
      initialValue: ["editor"],
      description:
        "At least one. Granting super admin is refused unless you are one.",
    },
    status: {
      label: "Status",
      component: "select",
      options: STAFF_STATUSES,
      variants: ["edit"],
    },
  },
} as const satisfies ResourceConfig;

/**
 * The typed input for this resource's fields (ADR-0035).
 *
 * One line, and from here on `<StaffFormInput fieldName="frstName" />` is a
 * compile error rather than a control that silently never renders. This is what
 * `as const` above is for: the literal key types survive into `keyof`.
 */
export const StaffFormInput = createAppFormInput(staffResourceConfig.fields);

/**
 * Domain failures the API reports without a field path, and the field an
 * operator would have to change to fix them.
 *
 * `STAFF_EMAIL_TAKEN` is a `409` whose `details` are empty — the conflict is
 * about the request rather than about a zod issue — so `applyServerErrors`
 * would otherwise put it at the top of the form when the answer is plainly the
 * email box. Data beside the config, not a callback at the call site, for the
 * reason everything else here is data.
 *
 * It maps only on the create form: `updateStaffBody` has no `email`, so the
 * edit form's field list does not contain one and the same code correctly lands
 * form-level there instead.
 */
export const STAFF_ERROR_FIELDS: Readonly<Partial<Record<ErrorCode, string>>> =
  { STAFF_EMAIL_TAKEN: "email" };
