import { z } from "zod";

import type { ResourceConfig } from "@/shared/resource/types";

/**
 * The demo resource the ADR-0035 machinery is proved against (`D3.6`).
 *
 * A fixture rather than a screen, and deliberately so: the machinery has to be
 * demonstrably config-driven *before* `D3.7` points it at staff, and the way to
 * show that is to drive it from a config that is nobody's real resource. A demo
 * page would need a route, a nav entry and an API that does not exist — scope
 * this step does not have and a screen D3 would then have to delete.
 *
 * It is deliberately wider than either real resource, so the registries are
 * exercised end to end: every field component, every filter kind, a formatter,
 * two cell renderers, a create-only field and an edit-only one.
 */
export const demoResourceConfig = {
  name: "widget",
  columns: {
    name: {
      header: "Name",
      sortable: true,
      filter: { kind: "text", op: "like", placeholder: "Contains…" },
    },
    status: {
      header: "Status",
      sortable: true,
      cellRenderer: "statusBadge",
      filter: {
        kind: "enum",
        op: "eq",
        options: ["active", "disabled"],
      },
    },
    tags: { header: "Tags", cellRenderer: "rolesList" },
    createdAt: {
      header: "Created",
      sortable: true,
      formatter: "date",
      filter: { kind: "dateRange", from: "gte", to: "lte" },
    },
    archivedAt: {
      header: "Archived",
      formatter: "dateTime",
      filter: {
        kind: "presence",
        op: "null",
        value: false,
        label: "Show archived",
      },
    },
    actions: { header: "Actions", cellRenderer: "rowActions", align: "end" },
  },
  fields: {
    name: { label: "Name", component: "input", initialValue: "" },
    secret: {
      label: "Initial password",
      component: "input",
      props: { type: "password" },
      variants: ["create"],
    },
    notes: {
      label: "Notes",
      component: "textarea",
      nullable: true,
      description: "Optional. Clearing it removes the note.",
    },
    status: {
      label: "Status",
      component: "select",
      options: ["active", "disabled"],
      variants: ["edit"],
    },
    tags: {
      label: "Tags",
      component: "multiCheckbox",
      options: ["alpha", "beta"],
      initialValue: ["alpha"],
    },
    featured: { label: "Featured", component: "switch", initialValue: false },
    accepted: {
      label: "Accept terms",
      component: "checkbox",
      initialValue: false,
    },
  },
} as const satisfies ResourceConfig;

/**
 * The demo's request schema, standing in for a `@repo/contracts` body.
 *
 * The real forms resolve against `createStaffBody` and friends (ADR-0035:
 * validation is the API's own schema, so client and server cannot drift). The
 * demo needs a schema of its own because it has no endpoint — but it is a zod
 * schema resolved the same way, so what the tests exercise is the wiring rather
 * than a mock of it.
 */
export const demoCreateBody = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  secret: z.string().min(1),
  notes: z.string().nullable(),
  tags: z.array(z.string()).min(1, "Pick at least one tag"),
  featured: z.boolean(),
  accepted: z.literal(true, { error: "You must accept the terms" }),
});

export type DemoCreateBody = z.infer<typeof demoCreateBody>;

/** One row of the demo grid. */
export interface DemoRow {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly archivedAt: string | null;
}

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
