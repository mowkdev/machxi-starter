import { STAFF_ROLES, STAFF_STATUSES } from "@repo/contracts";

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
  grid: {
    /*
     * A modal, which is what D3 shipped and what this record wants: five
     * fields, no reason for the list to stay legible beside them (ADR-0040).
     * `users` declares `"drawer"` for the opposite reason, and the two configs
     * are the whole difference between them — same form, same URL.
     */
    editSurface: "dialog",
    /*
     * What this grid *offers* (ADR-0038) — one line per affordance, and the
     * whole of what adding a resource costs beyond columns and fields.
     *
     * These are **not** permissions. `/admin/staff` mounts `authorize("admin")`
     * uniformly, so every flag below is conjoined with ADR-0042's `can()` above
     * the grid, and the API's guards remain the enforcement either way.
     *
     * `canBulkDelete` with `selectable`, never without — the pairing is checked
     * in `__tests__/staff.config.test.ts` rather than left to a reader, because
     * the failure mode is a toolbar button with nothing to act on. Staff is
     * also where the fan-out meets real refusals: ADR-0028's rank rule, the
     * last-super-admin invariant and the self-delete rule are all per row, so a
     * batch of these is where "2 deleted, 1 refused" is not a hypothetical.
     */
    selectable: true,
    canCreate: true,
    canEdit: true,
    canDelete: true,
    canBulkDelete: true,
    /*
     * The one stance this resource has (ADR-0039, `D4.4`).
     *
     * ADR-0039's own example declares two here — `status` and `roles` — and
     * `roles` cannot exist: `listStaffQuery.filterable` has no entry for it,
     * because `staff_roles` is a join table, which the ADR's own Context
     * paragraph says. `__tests__/staff.config.test.ts` runs every hot filter
     * through the contract exactly as it runs every column filter, so the
     * ADR's version would have failed a test before it failed an operator —
     * which is what that discipline is for. Amended in the ADR rather than
     * quietly dropped.
     *
     * `status` is a stance and not a composition: an operator asking "who is
     * disabled?" asks it many times a session, and the same field's header
     * dialog is still there and still agrees, because both write one entry.
     */
    hotFilters: [
      {
        kind: "enum",
        field: "status",
        label: "Status",
        op: "eq",
        options: STAFF_STATUSES,
      },
    ],
  },
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
      /*
       * `autoComplete: "off"` and deliberately **not** `"new-password"`.
       *
       * This box holds somebody else's credential. `new-password` next to an
       * `email` field is the signature a browser reads as "this person is
       * setting their own password", and the answer is a "Save password?"
       * prompt that would file the new operator's initial credential into the
       * acting admin's password manager and sync it to their account — a
       * password leaving the machine it was typed on, which is the opposite of
       * what ADR-0033 buys by keeping tokens in memory. `off` is a hint a
       * browser may still ignore, so this narrows the case rather than closing
       * it; the residual is recorded in the D3.7 step notes.
       */
      props: { type: "password", autoComplete: "off" },
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
  /**
   * The domain failure the API reports without a field path, and the box an
   * operator would have to change to fix it.
   *
   * `STAFF_EMAIL_TAKEN` is a `409` whose `details` are empty — the conflict is
   * about the request rather than about a zod issue — so `applyServerErrors`
   * would otherwise put it at the top of the form when the answer is plainly
   * the email field.
   *
   * It can only ever land on the create form, and not because of anything
   * declared here: each dialog passes `applyServerErrors` the field names of
   * *its own variant*, and `email` is create-only, so the edit form's list has
   * no `email` for this code to name and the message correctly falls through to
   * the form level there.
   */
  errorFields: { STAFF_EMAIL_TAKEN: "email" },
} as const satisfies ResourceConfig;

/**
 * The typed input for this resource's fields (ADR-0035).
 *
 * One line, and from here on `<StaffFormInput fieldName="frstName" />` is a
 * compile error rather than a control that silently never renders. This is what
 * `as const` above is for: the literal key types survive into `keyof`.
 */
export const StaffFormInput = createAppFormInput(staffResourceConfig.fields);
