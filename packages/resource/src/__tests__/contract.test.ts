import type { TranslationKey } from "@repo/i18n";
import { describe, expect, it } from "vitest";

import {
  assertConfigMatchesContract,
  type ResourceContract,
} from "../contract";
import type {
  ColumnConfig,
  FieldConfig,
  GridConfig,
  ResourceConfig,
} from "../types";

import { fakeBody, fakeListQuery, type FakeEndpoint } from "./fake-endpoint";

/**
 * The shared claims assertion (ADR-0063 §2, `D14.10`).
 *
 * Every negative control the two deleted per-resource suites carried, proved
 * once — because that is the trade this record makes: the claims stop being
 * copied into each resource's `__tests__` and become one function, so the
 * function is what has to be shown to fail. A silent assertion is worse than no
 * assertion, since it also stops anyone writing the real one.
 *
 * The fixtures are inline and the endpoint is a fake, for the reason the sibling
 * suite records: a package that borrowed an app's config would be a package
 * importing from an app, and a real contract cannot be made to refuse things.
 */

/**
 * A stand-in for a translation key.
 *
 * `TranslationKey` is `ParseKeys` over whatever catalogues the *program* merged,
 * and this package mounts none — so in here it is `never`, which is the property
 * ADR-0046 §13 wants working rather than a gap: nothing may claim to carry a key
 * before there is one. The copy is not what this suite is about, so it is cast
 * once, here, and the structure stays honestly typed.
 */
const KEY = "demo:key" as unknown as TranslationKey;

interface WidgetRow {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly createdAt: string;
  readonly archivedAt: string | null;
}

interface CreateWidgetBody {
  readonly name: string;
  readonly secret: string;
  readonly notes?: string | null;
}

interface UpdateWidgetBody {
  readonly name?: string;
  readonly status?: string;
  readonly notes?: string | null;
  /** A body key with no control — what an `errorFields` entry must not name. */
  readonly archived?: boolean;
}

type WidgetConfig = ResourceConfig<
  WidgetRow,
  CreateWidgetBody,
  UpdateWidgetBody
>;

const endpoint: FakeEndpoint = {
  sortable: ["name", "createdAt"],
  filterable: {
    name: ["like"],
    status: ["eq"],
    createdAt: ["gte", "lte"],
    archivedAt: ["null"],
  },
  values: { status: ["active", "disabled"] },
  searchable: true,
};

const contract = (
  overrides: Partial<ResourceContract> = {},
): ResourceContract => ({
  listQuery: fakeListQuery(endpoint),
  createBody: fakeBody({ required: ["name", "secret"], optional: ["notes"] }),
  updateBody: fakeBody({
    optional: ["name", "status", "notes", "archived"],
    nullable: ["notes"],
    nonEmpty: ["name", "notes"],
  }),
  ...overrides,
});

const NAME_COLUMN = {
  header: KEY,
  sortable: true,
  filter: { kind: "text", op: "like" },
} as const satisfies ColumnConfig;

const STATUS_COLUMN = {
  header: KEY,
  filter: { kind: "enum", op: "eq", options: ["active", "disabled"] },
} as const satisfies ColumnConfig;

const SECRET_FIELD = {
  label: KEY,
  component: "input",
  variants: ["create"],
} as const satisfies FieldConfig;

const GRID = {
  selectable: true,
  canBulkDelete: true,
  searchable: true,
  hotFilters: [
    {
      kind: "enum",
      field: "status",
      label: KEY,
      op: "eq",
      options: ["active", "disabled"],
    },
  ],
} as const satisfies GridConfig;

const config: WidgetConfig = {
  name: "widget",
  grid: GRID,
  columns: {
    name: NAME_COLUMN,
    status: STATUS_COLUMN,
    createdAt: {
      header: KEY,
      sortable: true,
      filter: { kind: "dateRange", from: "gte", to: "lte" },
    },
    archivedAt: { header: KEY },
    actions: { header: KEY, cellRenderer: "rowActions" },
  },
  fields: {
    name: { label: KEY, component: "input" },
    secret: SECRET_FIELD,
    notes: {
      label: KEY,
      component: "textarea",
      nullable: true,
      initialValue: null,
    },
    status: {
      label: KEY,
      component: "select",
      options: ["active", "disabled"],
      variants: ["edit"],
    },
  },
};

/** What the assertion complained about, or `null` for "it agreed". */
const complaintOf = (
  next: WidgetConfig,
  contractOverrides: Partial<ResourceContract> = {},
): string | null => {
  try {
    assertConfigMatchesContract(next, contract(contractOverrides));

    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

describe("assertConfigMatchesContract", () => {
  it("passes a config that agrees with its endpoint", () => {
    expect(complaintOf(config)).toBeNull();
  });

  it("refuses a sort the endpoint does not allow-list", () => {
    expect(
      complaintOf({
        ...config,
        columns: {
          ...config.columns,
          status: { ...STATUS_COLUMN, sortable: true },
        },
      }),
    ).toMatch(/column `status` declares `sortable`/);
  });

  it("refuses a column that hides a sort the endpoint offers", () => {
    // The cheaper mistake, and the one nobody reports: a missing feature reads
    // as a decision rather than as a defect.
    expect(
      complaintOf({
        ...config,
        columns: { ...config.columns, name: { header: KEY } },
      }),
    ).toMatch(/but the endpoint sorts by it/);
  });

  it("refuses a filter operator the endpoint does not accept", () => {
    expect(
      complaintOf({
        ...config,
        columns: {
          ...config.columns,
          name: { ...NAME_COLUMN, filter: { kind: "text", op: "eq" } },
        },
      }),
    ).toMatch(/column `name`'s text filter is not allow-listed/);
  });

  it("refuses a hot filter offering a value outside the endpoint's enum", () => {
    expect(
      complaintOf({
        ...config,
        grid: {
          ...GRID,
          hotFilters: [
            {
              kind: "enum",
              field: "status",
              label: KEY,
              op: "eq",
              options: ["active", "archived"],
            },
          ],
        },
      }),
    ).toMatch(/offers `archived`, the endpoint does not/);
  });

  it("refuses a search box over an endpoint with no `q`", () => {
    expect(
      complaintOf(config, {
        listQuery: fakeListQuery({ ...endpoint, searchable: false }),
      }),
    ).toMatch(/declares `searchable`, the endpoint has no `q`/);
  });

  it("refuses a searchable endpoint whose grid offers no search box", () => {
    expect(
      complaintOf({ ...config, grid: { ...GRID, searchable: false } }),
    ).toMatch(/the endpoint accepts `q`/);
  });

  it("refuses a bulk action with nothing to select", () => {
    expect(
      complaintOf({ ...config, grid: { ...GRID, selectable: false } }),
    ).toMatch(/`canBulkDelete` without `selectable`/);
  });

  it("refuses a create form missing a key the body requires", () => {
    expect(
      complaintOf({
        ...config,
        fields: {
          ...config.fields,
          secret: { ...SECRET_FIELD, variants: ["edit"] },
        },
      }),
    ).toMatch(/`secret` is required by the create body and has no field/);
  });

  it("refuses a `nullable` field the update body will not clear", () => {
    expect(
      complaintOf(config, {
        updateBody: fakeBody({ optional: ["name", "status", "notes"] }),
      }),
    ).toMatch(/field `notes` is `nullable`, the update body refuses `null`/);
  });

  it("refuses an `errorFields` entry naming a field the config does not draw", () => {
    // The half the type cannot make: it constrains the name to a *body* key,
    // and `archived` is one — with no control for the sentence to land on.
    expect(
      complaintOf({ ...config, errorFields: { VALIDATION_ERROR: "archived" } }),
    ).toMatch(/names `archived`, which no field declares/);
  });

  it("refuses a `nullable` field seeded with a value the body refuses", () => {
    // `""` and `null` look equivalent and are two of the three requests the
    // contract distinguishes; only one of them is a legal edit.
    expect(
      complaintOf({
        ...config,
        fields: {
          ...config.fields,
          notes: {
            label: KEY,
            component: "textarea",
            nullable: true,
            initialValue: "",
          },
        },
      }),
    ).toMatch(/field `notes` starts at "", which the update body refuses/);
  });

  it("refuses an exact-match text filter on a field no prefix satisfies", () => {
    /*
     * The email case, generically: the operator types into the box, so an `eq`
     * control over a field whose value schema refuses a partial term answers
     * every keystroke with a `VALIDATION_ERROR`. `like` is the answer, and
     * ADR-0014 exempts it from the field's value schema.
     */
    expect(
      complaintOf(
        {
          ...config,
          columns: {
            ...config.columns,
            name: { ...NAME_COLUMN, filter: { kind: "text", op: "eq" } },
          },
        },
        {
          listQuery: fakeListQuery({
            ...endpoint,
            filterable: { ...endpoint.filterable, name: ["like", "eq"] },
            values: { ...endpoint.values, name: ["Sample"] },
          }),
        },
      ),
    ).toMatch(/column `name`'s text filter is not allow-listed/);
  });

  it("refuses an option the catalogue does not label", () => {
    expect(
      complaintOf(config, { optionLabelled: (value) => value !== "disabled" }),
    ).toMatch(/option `disabled` has no `common:options` label/);
  });

  it("reports every violation at once", () => {
    const complaint = complaintOf(
      { ...config, grid: { ...GRID, selectable: false, searchable: false } },
      { optionLabelled: () => false },
    );

    // Failing on the first would hide the rest, and a config being brought up
    // to a changed contract usually has more than one.
    expect(complaint).toMatch(/`canBulkDelete` without `selectable`/);
    expect(complaint).toMatch(/the endpoint accepts `q`/);
    expect(complaint).toMatch(/has no `common:options` label/);
  });
});
