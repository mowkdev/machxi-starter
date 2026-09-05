import { ORGANIZATION_KINDS } from "@repo/contracts";
import type {
  CreateOrganizationAdminBody,
  OrganizationResource,
  UpdateOrganizationBody,
} from "@repo/contracts";

import { createAppFormInput } from "@/shared/form/app-form-input";
import type { ResourceConfig } from "@/shared/resource/types";

/**
 * The organization resource, declared once (ADR-0035, ADR-0063 §1).
 *
 * Columns and fields sit together so the grid and the two forms cannot disagree
 * about what a organization is. The three type arguments are the contract: columns
 * are keyed by `OrganizationResource` and fields by the two bodies, so a
 * misspelt key is a compile error on the line that wrote it rather than a
 * header over an empty column.
 *
 * **Every `sortable` and every `filter` below is a claim about
 * `listOrganizationsQuery`**, and no type can reach an endpoint's
 * allow-lists — `__tests__/organization.config.test.ts` is where the
 * claims meet the schema, in both directions.
 *
 * `as const satisfies` is the authoring form and is load-bearing: it keeps the
 * literal key types {@link createAppFormInput} needs, and it makes a key
 * outside `GridConfig` an excess-property error.
 */
export const organizationResourceConfig = {
  name: "organizations",
  grid: {
    /*
     * Which shell `new` and `$id` render in (ADR-0040). `"dialog"` for a short
     * form, `"drawer"` where the list should stay legible beside it, `"page"`
     * where the record is the screen.
     */
    /*
     * `"page"`, and the reason is the members section (ADR-0040, ADR-0044):
     * this is the first record in the app that is more than its own form — a
     * name and a slug beside a table of the people in it — and neither of the
     * two overlays can hold that. A dialog would put a scrolling table inside
     * a modal; a drawer would put it in a column narrower than the grid it
     * came from.
     *
     * It also changes what the route does: `fullHeight` is computed from this
     * line, so the record gets the shell's whole height rather than a fixed
     * overlay, and the grid behind it is not held in memory while it is open.
     */
    editSurface: "page",
    /*
     * What this grid *offers* (ADR-0038) — one line per affordance.
     *
     * These are **not** permissions: they are conjoined with ADR-0042's `can()`
     * above the grid, and the API's guards remain the enforcement either way.
     * `canBulkDelete` goes with `selectable`, never without — the config test
     * refuses the pair, because the failure mode is a toolbar button with
     * nothing to act on.
     */
    selectable: true,
    canCreate: true,
    canEdit: true,
    canDelete: true,
    canBulkDelete: true,
    /*
     * Whether the endpoint implements ADR-0014's `q` (ADR-0063 §2). A claim
     * about the contract like every other line here, checked in both
     * directions: a search box over an endpoint with no `q` returns an
     * unfiltered page and looks like a working one.
     */
    searchable: true,
    /*
     * The stances this resource offers one press away (ADR-0039). None by
     * default: a hot filter is a claim that operators ask this question many
     * times a session, and that is a product decision rather than a shape.
     */
    hotFilters: [
      /*
       * The one stance this screen needs, and without it the `deletedAt`
       * column below could never hold a value: the repository's default scope
       * steps aside only when the query *mentions* `deletedAt`, so with no
       * control that mentions it a deleted tenant is unreachable from the only
       * screen that lists tenants — its memberships surviving and its slug
       * released, with nothing to confirm the delete against (`D15.4`'s
       * review).
       *
       * The users screen's control, which is the one that survived `D4.6`: the
       * duplicate that step dropped was the *column* filter icon, not this.
       */
      {
        kind: "presence",
        field: "deletedAt",
        label: "organizations:filters.deletedOnly",
        op: "null",
        value: false,
      },
    ],
  },
  columns: {
    name: {
      header: "organizations:columns.name",
      sortable: true,
      /*
       * `like` and not `eq`, the users reading: an operator types a partial
       * term, and ADR-0014 exempts `like` from the field's value schema
       * because a pattern is not a value of the column's type.
       */
      filter: {
        kind: "text",
        op: "like",
        placeholder: "grid:filter.containsPlaceholder",
      },
    },
    slug: {
      header: "organizations:columns.slug",
      sortable: true,
      // A URL segment is data, not prose (ADR-0054 §4).
      mono: true,
      filter: {
        kind: "text",
        op: "like",
        placeholder: "grid:filter.containsPlaceholder",
      },
    },
    kind: {
      header: "organizations:columns.kind",
      sortable: true,
      cellRenderer: "statusBadge",
      filter: { kind: "enum", op: "eq", options: ORGANIZATION_KINDS },
    },
    createdAt: {
      header: "organizations:columns.createdAt",
      sortable: true,
      formatter: "date",
      mono: true,
      filter: { kind: "dateRange", from: "gte", to: "lte" },
    },
    deletedAt: {
      header: "organizations:columns.deletedAt",
      /*
       * The visible mark, and the users column's reasoning applied to a
       * tenant: a soft-deleted organization is listed like any other when the
       * query asks about `deletedAt`, and nothing else on the row says which
       * of the two it is. Not `sortable` — `listOrganizationsQuery` does not
       * allow-list it, and its only index is partial, so offering an arrow the
       * API answers with a `VALIDATION_ERROR` is worse than offering none.
       *
       * No filter icon: the users screen made the same stance a toolbar hot
       * filter at `D4.4` and dropped the duplicate control at `D4.6`, and this
       * screen starts where that one ended.
       */
      formatter: "dateTime",
      mono: true,
    },
    actions: {
      header: "organizations:columns.actions",
      cellRenderer: "rowActions",
      align: "end",
    },
  },
  fields: {
    name: {
      label: "organizations:fields.name.label",
      component: "input",
      initialValue: "",
    },
    slug: {
      label: "organizations:fields.slug.label",
      description: "organizations:fields.slug.description",
      component: "input",
      initialValue: "",
    },
    /*
     * The one field on the create body that is not on the update one, and the
     * asymmetry is ADR-0067 §3 rather than an oversight: **staff are never
     * members**, so somebody has to be named as the owner of an organization
     * staff bring into existence, and it cannot be the operator. It is a user
     * id rather than an address because staff already list accounts — there is
     * nothing here to enumerate — and it is not editable afterwards, because
     * moving ownership is a membership write on the sub-resource below rather
     * than a property of the organization.
     */
    ownerId: {
      label: "organizations:fields.ownerId.label",
      description: "organizations:fields.ownerId.description",
      component: "input",
      // Create only, which is what makes the two bodies' asymmetry a fact of
      // the config rather than a rule the two surfaces each have to remember.
      variants: ["create"],
      initialValue: "",
    },
  },
  /*
   * The domain failures the API reports with no field path, and the box an
   * operator would have to change to fix each one (ADR-0035): a conflict is
   * about the *request* and carries no zod issue, so without an entry here it
   * lands at the top of the form rather than under the control that caused it.
   *
   * `CONFLICT` is the taken slug — the only `409` either form can produce, the
   * others being about an organization's state rather than a field. It points
   * at `slug` because that is the box to change; the create form's other
   * refusal, an owner id nothing holds, is a `404` and reaches the form the
   * same way, so it is mapped too.
   */
  errorFields: {
    CONFLICT: "slug",
    /*
     * A slug edit aimed at a `personal` organization (ADR-0067 §2). It shares
     * the deletion refusal's code, and it belongs under this box for the
     * reason the map exists: the slug is what the operator would change, and a
     * message at the top of a two-field form says less than the same sentence
     * beside the control that caused it.
     */
    ORGANIZATION_PERSONAL_UNDELETABLE: "slug",
    NOT_FOUND: "ownerId",
  },
} as const satisfies ResourceConfig<
  OrganizationResource,
  CreateOrganizationAdminBody,
  UpdateOrganizationBody
>;

/**
 * The typed input for this resource's fields (ADR-0035).
 *
 * One line, and from here on `<OrganizationFormInput fieldName="nmae" />`
 * is a compile error rather than a control that silently never renders.
 */
export const OrganizationFormInput = createAppFormInput(
  organizationResourceConfig.fields,
);
