import type { ColumnConfigMap } from "@repo/resource";

import type demo from "./demo-catalogue.json";

/**
 * The demo resource's grid half, as the grid's own suite reads it (`D22.3`,
 * ADR-0077 §4).
 *
 * The admin's `test/fixtures/demo-resource.ts` is what the door-level suites
 * ran on, and it moved here with them — **the columns and the rows only**,
 * because they are all a grid reads; the fields and the request bodies went to
 * `@repo/form`'s suite with the form cases. The config is still nobody's real
 * resource, and still deliberately wider than either shipped one: every filter
 * kind, a formatter on two columns, two cell renderers and the row menu.
 *
 * Its copy is keys in a `demo:` namespace of its own, declared through
 * `ResourceNamespaceMap` below and composed into the harness's instance by
 * `demo-i18n.ts` — the rule ADR-0046 §13 gives a package, applied to a
 * fixture. The one exception is the `Contains…` placeholder, which is the
 * grid's own generic copy.
 */
declare module "i18next" {
  interface ResourceNamespaceMap {
    demo: typeof demo;
  }
}

/** One row of the demo grid. */
export interface DemoRow {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly archivedAt: string | null;
}

export const demoResourceConfig = {
  name: "widget",
  columns: {
    name: {
      header: "demo:columns.name",
      sortable: true,
      filter: {
        kind: "text",
        op: "like",
        placeholder: "grid:filter.containsPlaceholder",
      },
    },
    status: {
      header: "demo:columns.status",
      sortable: true,
      cellRenderer: "statusBadge",
      filter: {
        kind: "enum",
        op: "eq",
        options: ["active", "disabled"],
      },
    },
    tags: { header: "demo:columns.tags", cellRenderer: "rolesList" },
    createdAt: {
      header: "demo:columns.createdAt",
      sortable: true,
      formatter: "date",
      filter: { kind: "dateRange", from: "gte", to: "lte" },
    },
    archivedAt: {
      header: "demo:columns.archivedAt",
      formatter: "dateTime",
      filter: {
        kind: "presence",
        op: "null",
        value: false,
        label: "demo:filters.showArchived",
      },
    },
    actions: {
      header: "demo:columns.actions",
      cellRenderer: "rowActions",
      align: "end",
    },
  },
} as const satisfies {
  readonly name: string;
  readonly columns: ColumnConfigMap<DemoRow>;
};

export const demoRows: readonly DemoRow[] = [
  {
    id: "1",
    name: "Sprocket",
    status: "active",
    tags: ["alpha"],
    createdAt: "2026-01-15T10:00:00.000Z",
    archivedAt: null,
  },
  {
    id: "2",
    name: "Flange",
    status: "disabled",
    tags: ["alpha", "beta"],
    createdAt: "2026-02-20T10:00:00.000Z",
    archivedAt: "2026-03-01T10:00:00.000Z",
  },
];
