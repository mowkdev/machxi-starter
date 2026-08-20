import { USER_STATUSES } from "@repo/contracts";

import { createAppFormInput } from "@/shared/form/app-form-input";
import type { ResourceConfig } from "@/shared/resource/types";

/**
 * The users resource, declared once (ADR-0035).
 *
 * The second consumer, and the measure of the machinery: if this file plus two
 * thin pages is the whole of it, the config-driven bet paid. Four things differ
 * from staff, and each is a property of the *contract* rather than a style
 * choice — which is the argument for declaring resources as data in the first
 * place.
 *
 * - **`deletedAt` is a column**, because deletion here is soft (ADR-0028): the
 *   row survives, an admin still lists and opens it, and `USER_STATUSES` has no
 *   `deleted` member on purpose. The timestamp is the mark. It is deliberately
 *   not `sortable` — `listUsersQuery` does not allow-list it — and it carries
 *   the one `presence` filter in the app.
 * - **Names are nullable and start `null`**, because `users.first_name` is a
 *   nullable column and `updateUserBody` accepts `null` to clear it. The pair
 *   is what makes one declaration serve both forms: see the note on the field.
 * - **`status` appears in both variants**, because `createUserBody` takes one
 *   where `createStaffBody` does not.
 * - **`roles` is a column and not a field.** `USER_ROLES` has exactly one
 *   member in v1, so a control over it could only ever be in one valid state,
 *   and `userRolesSchema` requires at least one if the key is present — an
 *   operator could only use it to make the form invalid. The service defaults
 *   the role (ADR-0017), the contract makes the key optional, and the grid
 *   still shows what an account holds. The day `USER_ROLES` gains a second
 *   member, this is one line.
 *
 * Every `sortable` and every `filter` below is a claim about `listUsersQuery`,
 * and `__tests__/user.config.test.ts` runs each of them through it.
 */
export const userResourceConfig = {
  name: "user",
  grid: {
    /*
     * A right-side drawer, deliberately not `staff`'s modal (ADR-0040).
     *
     * Partly because this record earns it — a customer account is read in the
     * context of the rows around it, and a sheet leaves those on screen — and
     * partly because a switch nothing exercises is a switch that rots. The URL
     * is identical either way, so nothing else in this slice knows.
     */
    editSurface: "drawer",
  },
  columns: {
    email: {
      header: "Email",
      sortable: true,
      // `like` and not `eq`, for the reason the staff config records: the
      // field's value schema is `emailSchema`, which no partial term satisfies.
      filter: { kind: "text", op: "like", placeholder: "Contains…" },
    },
    firstName: { header: "First name", sortable: true },
    lastName: { header: "Last name", sortable: true },
    roles: { header: "Roles", cellRenderer: "rolesList" },
    status: {
      header: "Status",
      sortable: true,
      cellRenderer: "statusBadge",
      filter: { kind: "enum", op: "eq", options: USER_STATUSES },
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
    deletedAt: {
      header: "Deleted",
      /*
       * The visible mark ADR-0028's read path needs. A deleted account is
       * listed like any other and reports `status: "disabled"`, so without a
       * column of its own nothing on the row says which of the two it is. The
       * `dateTime` formatter renders `—` for a live account, so the mark is the
       * presence of a date rather than an extra symbol to learn.
       *
       * Not `sortable`: `listUsersQuery` does not allow-list it, and offering
       * an arrow the API answers with a `VALIDATION_ERROR` is worse than
       * offering none.
       */
      formatter: "dateTime",
      /*
       * **"Deleted only", not "show deleted"** — and the label is the finding.
       *
       * ADR-0035 and the `presence` kind's own doc both describe this control
       * as "show deleted users", which is what one would want and is not what
       * the endpoint can do. `filter[deletedAt][null]=false` means
       * `deleted_at is not null`, and the repository's default scope "steps
       * aside as soon as the query mentions `deletedAt`" — so checking the box
       * replaces the live accounts with the deleted ones rather than adding
       * them. There is no third request available: `deletedAt` is allow-listed
       * for `null` alone, so the client can ask for live *or* deleted, never
       * both, and a checkbox is a scope switch here rather than an additive
       * filter. Labelling it "Show deleted" would be the UI making a promise
       * the contract cannot keep, which is the one thing the config-versus-
       * contract discipline exists to prevent. ADR-0035 amended (D3.8).
       *
       * Unchecked still writes *nothing* rather than the opposite, because
       * "no opinion" and "only the live ones" really are the same request to
       * an endpoint whose default scope hides them (ADR-0014).
       */
      filter: {
        kind: "presence",
        op: "null",
        value: false,
        label: "Deleted only",
      },
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
      // `off`, never `new-password`: this box holds the new customer's
      // credential, not the operator's, and the browser must not offer to save
      // it as theirs. Same reasoning as the staff config records.
      props: { type: "password", autoComplete: "off" },
      description:
        "Hand this over out of band and ask them to change it. Nothing forces a change at first sign-in.",
      variants: ["create"],
    },
    /*
     * `nullable` **and** `initialValue: null`, which together let one
     * declaration serve both forms without a per-variant flag.
     *
     * The contract distinguishes three things a request can say about a name:
     * leave it (absent), set it (a string), clear it (`null`) — and `""`
     * expresses none of them, because `nameSchema` is `.trim().min(1)`.
     * `nullable` is what makes an emptied control produce `null` rather than
     * `""`, and seeding `null` is what makes an untouched one equal to its
     * default. The two forms then read that same state differently, each
     * according to its own body: the edit form prunes to `dirtyFields`, so an
     * untouched name is absent and a cleared one is `null`; the create form
     * drops `null` entirely, because `createUserBody` has no "clear it" to
     * express and blank there can only mean "not provided".
     */
    firstName: {
      label: "First name",
      component: "input",
      nullable: true,
      initialValue: null,
    },
    lastName: {
      label: "Last name",
      component: "input",
      nullable: true,
      initialValue: null,
    },
    status: {
      label: "Status",
      component: "select",
      options: USER_STATUSES,
      placeholder: "Default (active)",
      /*
       * `""` rather than a status: `createUserBody.status` is optional and the
       * service decides the default (ADR-0018 starts users `active`). An
       * unanswered `select` shows its placeholder, the create form reads that
       * as "no choice" and omits the key, and the server's default stands —
       * which is a different request from "this operator chose active", and the
       * one that stays right if the default ever changes.
       */
      initialValue: "",
    },
  },
  /**
   * `USER_EMAIL_TAKEN` is a `409` with no `details`, and the answer to it is
   * the email box.
   *
   * There is deliberately no entry for `USER_DELETED`: that one is a conflict
   * with the *account's state*, not with anything on the form, and there is no
   * field an operator could change to satisfy it. It lands form-level, which is
   * the honest place for "this cannot be done at all".
   */
  errorFields: { USER_EMAIL_TAKEN: "email" },
} as const satisfies ResourceConfig;

/** The typed input for this resource's fields (ADR-0035). */
export const UserFormInput = createAppFormInput(userResourceConfig.fields);
