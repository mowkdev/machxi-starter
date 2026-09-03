import {
  USER_STATUSES,
  type CreateUserBody,
  type UpdateUserBody,
  type UserResource,
} from "@repo/contracts";

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
 *   not `sortable` — `listUsersQuery` does not allow-list it — and since `D4.6`
 *   it carries no filter either: the app's one `presence` control is the
 *   toolbar's "Deleted only" hot filter, and this column is the mark alone.
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
    /*
     * The same five flags staff declares (ADR-0038), and this resource is where
     * the difference between a capability and a permission becomes visible.
     *
     * `/admin/users` mounts `authorize("admin", "manager")` and the router
     * refines five writing routes back to `admin` — so a `manager` reaching
     * this screen is offered by *this config* everything an `admin` is, and
     * ADR-0042's narrowing above the grid is what takes Create and Delete away
     * from them. The config says what the surface offers; `can()` says who may
     * use it. Two questions, both answered before an affordance renders.
     */
    selectable: true,
    canCreate: true,
    canEdit: true,
    canDelete: true,
    canBulkDelete: true,
    // `q` searches email and name on this endpoint (`listUsersQuery`); the
    // staff config records why it is declared here rather than on the page.
    searchable: true,
    /*
     * Two stances, and the second is the one ADR-0039 anticipated (`D4.4`).
     *
     * "Deleted only" was the app's only `presence` control and it lived in the
     * filter row, where it was a checkbox an operator had to find among six
     * other cells. It is the definition of a stance — pressed and released many
     * times a session — so it becomes the first `presence` hot filter, which is
     * exactly what ADR-0039 §Consequences expects.
     *
     * **`D4.6` made this the only control for that stance.** `D4.4` left the
     * `deletedAt` column's dialog control in place as well, so one filter had
     * two controls three inches apart; ADR-0039 deferred the choice to the
     * sweep and the sweep dropped the duplicate. The column still exists —
     * it is the mark a soft delete leaves — it simply no longer offers a
     * second way to press this. Since `D10.2` the applied-filters bar *does*
     * show a chip for it as well (ADR-0052 retires ADR-0039's suppression):
     * one control, two indications, which is the trade the operator asked for
     * — the bar answers "what am I looking at?" with no exceptions in it.
     */
    hotFilters: [
      {
        kind: "enum",
        field: "status",
        label: "users:filters.status",
        op: "eq",
        options: USER_STATUSES,
      },
      {
        kind: "presence",
        field: "deletedAt",
        label: "users:filters.deletedOnly",
        op: "null",
        value: false,
      },
    ],
  },
  columns: {
    email: {
      header: "users:columns.email",
      sortable: true,
      // Mono, for the reason the staff config records: an address is data.
      mono: true,
      // `like` and not `eq`, for the reason the staff config records: the
      // field's value schema is `emailSchema`, which no partial term satisfies.
      filter: {
        kind: "text",
        op: "like",
        placeholder: "grid:filter.containsPlaceholder",
      },
    },
    firstName: { header: "users:columns.firstName", sortable: true },
    lastName: { header: "users:columns.lastName", sortable: true },
    roles: { header: "users:columns.roles", cellRenderer: "rolesList" },
    status: {
      header: "users:columns.status",
      sortable: true,
      cellRenderer: "statusBadge",
      filter: { kind: "enum", op: "eq", options: USER_STATUSES },
    },
    lastLoginAt: {
      header: "users:columns.lastLoginAt",
      sortable: true,
      formatter: "dateTime",
      mono: true,
      filter: { kind: "dateRange", from: "gte", to: "lte" },
    },
    createdAt: {
      header: "users:columns.createdAt",
      sortable: true,
      formatter: "date",
      mono: true,
      filter: { kind: "dateRange", from: "gte", to: "lte" },
    },
    deletedAt: {
      header: "users:columns.deletedAt",
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
      mono: true,
      /*
       * **No filter icon here, and that is `D4.6` closing a question ADR-0039
       * left open.** This column carried the app's one `presence` control, and
       * `D4.4` made the same filter a toolbar hot filter — leaving the operator
       * two ways to one stance, three inches apart. The ADR deferred the choice
       * to the sweep; the sweep drops the duplicate.
       *
       * The **column stays**, because it is not the filter: a soft-deleted
       * account is listed like any other and reports `status: "disabled"`
       * (ADR-0028), so the timestamp is the only thing on the row that says
       * which of the two it is. What it stops carrying is a second control for
       * a filter the toolbar already presses.
       *
       * The reasoning that made the label right is still the toolbar's to keep,
       * and it is worth restating where the column can see it:
       * `filter[deletedAt][null]=false` means `deleted_at is not null`, and the
       * repository's default scope steps aside as soon as the query mentions
       * `deletedAt` — so pressing it **replaces** the live accounts with the
       * deleted ones rather than adding them. There is no third request:
       * `deletedAt` is allow-listed for `null` alone, so the client can ask for
       * live *or* deleted, never both. "Show deleted" would have been the UI
       * promising what the contract cannot keep (ADR-0035, amended D3.8).
       */
    },
    actions: {
      header: "users:columns.actions",
      cellRenderer: "rowActions",
      align: "end",
    },
  },
  fields: {
    email: {
      label: "users:fields.email.label",
      component: "input",
      props: { type: "email", autoComplete: "off" },
      variants: ["create"],
    },
    password: {
      label: "users:fields.password.label",
      component: "input",
      // `off`, never `new-password`: this box holds the new customer's
      // credential, not the operator's, and the browser must not offer to save
      // it as theirs. Same reasoning as the staff config records.
      props: { type: "password", autoComplete: "off" },
      description: "users:fields.password.description",
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
      label: "users:fields.firstName.label",
      component: "input",
      nullable: true,
      initialValue: null,
    },
    lastName: {
      label: "users:fields.lastName.label",
      component: "input",
      nullable: true,
      initialValue: null,
    },
    status: {
      label: "users:fields.status.label",
      component: "select",
      options: USER_STATUSES,
      placeholder: "users:fields.status.placeholder",
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
} as const satisfies ResourceConfig<
  UserResource,
  CreateUserBody,
  UpdateUserBody
>;

/** The typed input for this resource's fields (ADR-0035). */
export const UserFormInput = createAppFormInput(userResourceConfig.fields);
