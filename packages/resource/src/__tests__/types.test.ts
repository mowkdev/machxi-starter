import type { TranslationKey } from "@repo/i18n";
import { describe, expect, it } from "vitest";

import type { ColumnConfigMap, FieldConfigMap, ResourceConfig } from "../types";

/**
 * What the type says, asserted by the type checker (ADR-0063 §1, `D14.10`).
 *
 * **`pnpm check-types` is what runs this suite**, and the `expect`s below are
 * only there to give each case a name in the report — every claim it makes is a
 * `@ts-expect-error` that fails the build if the error it names stops being an
 * error. That is the same discipline the config tests used for `TranslationKey`
 * since `D7.4`, applied to the two claims ADR-0035 could previously only make at
 * runtime:
 *
 * - a **column** that is not a field of the row renders a header and an empty
 *   cell, because the grid resolves each column by `accessorKey`;
 * - a **field** neither body has room for renders a control the API answers with
 *   a `VALIDATION_ERROR` on submit, which the operator meets as a toast on a
 *   form that looked complete.
 *
 * Both compiled before this step. Neither compiles now.
 */

/** A stand-in key: this package mounts no catalogue, so `TranslationKey` is `never` here. */
const KEY = "demo:key" as unknown as TranslationKey;

interface WidgetRow {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

interface CreateWidgetBody {
  readonly name: string;
  readonly secret: string;
}

interface UpdateWidgetBody {
  readonly name?: string;
  readonly status?: string;
}

describe("ColumnConfigMap", () => {
  it("takes the row's own field names", () => {
    const columns = {
      name: { header: KEY, sortable: true },
      status: { header: KEY },
    } as const satisfies ColumnConfigMap<WidgetRow>;

    expect(Object.keys(columns)).toHaveLength(2);
  });

  it("takes the reserved structural column, which is chrome rather than a field", () => {
    // `actions` reads the row rather than a value of it (ADR-0041), so it is
    // the one key that belongs to no field.
    const columns = {
      actions: { header: KEY, cellRenderer: "rowActions", align: "end" },
    } as const satisfies ColumnConfigMap<WidgetRow>;

    expect(Object.keys(columns)).toEqual(["actions"]);
  });

  it("makes a misspelt column a compile error rather than an empty cell", () => {
    const columns = {
      // @ts-expect-error `nmae` is not a field of the row — before `D14.10`
      // this compiled, rendered a header and an empty cell under it.
      nmae: { header: KEY, sortable: true },
    } as const satisfies ColumnConfigMap<WidgetRow>;

    expect(Object.keys(columns)).toHaveLength(1);
  });
});

describe("FieldConfigMap", () => {
  it("takes a name from either body", () => {
    const fields = {
      // `secret` is create-only and `status` edit-only; the map is keyed by
      // both bodies, and `variants` is what says which form draws which.
      secret: { label: KEY, component: "input", variants: ["create"] },
      status: { label: KEY, component: "select", variants: ["edit"] },
    } as const satisfies FieldConfigMap<CreateWidgetBody & UpdateWidgetBody>;

    expect(Object.keys(fields)).toHaveLength(2);
  });

  it("makes a field neither body has room for a compile error", () => {
    const fields = {
      // @ts-expect-error `department` is in no body — the control would render
      // and the API would refuse the submit.
      department: { label: KEY, component: "input" },
    } as const satisfies FieldConfigMap<CreateWidgetBody & UpdateWidgetBody>;

    expect(Object.keys(fields)).toHaveLength(1);
  });
});

describe("ResourceConfig", () => {
  it("carries the row and both bodies, and checks `errorFields` against them", () => {
    const config = {
      name: "widget",
      columns: { name: { header: KEY } },
      fields: { name: { label: KEY, component: "input" } },
      errorFields: { VALIDATION_ERROR: "name" },
    } as const satisfies ResourceConfig<
      WidgetRow,
      CreateWidgetBody,
      UpdateWidgetBody
    >;

    expect(config.name).toBe("widget");
  });

  it("makes an `errorFields` entry pointing at no field a compile error", () => {
    const config = {
      name: "widget",
      columns: { name: { header: KEY } },
      fields: { name: { label: KEY, component: "input" } },
      // @ts-expect-error `email` is in neither body, so the API's sentence
      // would land on a box no form draws.
      errorFields: { VALIDATION_ERROR: "email" },
    } as const satisfies ResourceConfig<
      WidgetRow,
      CreateWidgetBody,
      UpdateWidgetBody
    >;

    expect(config.name).toBe("widget");
  });

  it("still names itself without arguments, for a reader that has no row", () => {
    // `editSurfaceOf`, `@repo/grid`'s internals and the customer app's
    // fields-only maps all take the defaulted form (ADR-0063 §Consequences).
    const widened: ResourceConfig = {
      name: "widget",
      columns: { anything: { header: KEY } },
      fields: { anything: { label: KEY, component: "input" } },
    };

    expect(widened.name).toBe("widget");
  });
});
