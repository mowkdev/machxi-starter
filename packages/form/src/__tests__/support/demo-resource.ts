import type { FieldConfigMap } from "@repo/resource";
import { z } from "zod";

import type demo from "./demo-catalogue.json";

/**
 * The demo resource's form half, as the form machinery's own suite reads it
 * (`D22.3`, ADR-0077 §4).
 *
 * The admin's `test/fixtures/demo-resource.ts` is what the door-level suites
 * ran on, and it moved here with them — **the fields and the request bodies
 * only**, because they are all a form reads; the columns and the rows went to
 * `@repo/grid`'s suite with the grid cases. It is still nobody's real
 * resource, and still wider than either shipped one: every registered field
 * component, a create-only field and an edit-only one.
 *
 * Its copy is keys in a `demo:` namespace of its own, declared through
 * `ResourceNamespaceMap` below and composed into the harness's instance by
 * `render.tsx` — the rule ADR-0046 §13 gives a package, applied to a fixture.
 */
declare module "i18next" {
  interface ResourceNamespaceMap {
    demo: typeof demo;
  }
}

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

/**
 * The update body — every attribute optional, plus the `status` the create
 * form does not offer, so that `variants` is a checkable claim (ADR-0063 §1).
 */
export const demoUpdateBody = demoCreateBody
  .partial()
  .extend({ status: z.enum(["active", "disabled"]).optional() });

export type DemoUpdateBody = z.infer<typeof demoUpdateBody>;

export const demoResourceConfig = {
  name: "widget",
  fields: {
    name: {
      label: "demo:fields.name.label",
      component: "input",
      initialValue: "",
    },
    secret: {
      label: "demo:fields.secret.label",
      component: "input",
      props: { type: "password" },
      variants: ["create"],
    },
    notes: {
      label: "demo:fields.notes.label",
      component: "textarea",
      nullable: true,
      description: "demo:fields.notes.description",
    },
    status: {
      label: "demo:fields.status.label",
      component: "select",
      options: ["active", "disabled"],
      variants: ["edit"],
    },
    tags: {
      label: "demo:fields.tags.label",
      component: "multiCheckbox",
      options: ["alpha", "beta"],
      initialValue: ["alpha"],
    },
    featured: {
      label: "demo:fields.featured.label",
      component: "switch",
      initialValue: false,
    },
    accepted: {
      label: "demo:fields.accepted.label",
      component: "checkbox",
      initialValue: false,
    },
  },
} as const satisfies {
  readonly name: string;
  readonly fields: FieldConfigMap<DemoCreateBody & DemoUpdateBody>;
};
