import { describe, expect, it } from "vitest";

import {
  humanize,
  mergeColumns,
  optionValues,
  resolveOptions,
} from "../config";
import type { TranslateKey } from "@repo/i18n";

import type { ColumnConfigMap } from "../types";

/**
 * The vocabulary's own suite (`D9.3`, ADR-0051).
 *
 * **It covers what this package can be asked about with nothing else
 * mounted**: the pure readers over a config object. The larger file the
 * extraction left in `apps/admin` — `shared/resource/__tests__/config.test.ts`
 * — stays there unchanged, and that is the right home for it: it drives these
 * same functions through the *demo fixture* and a real i18next instance built
 * from the app's catalogues, which is an integration between this vocabulary
 * and a dictionary, and a dictionary belongs to an app (ADR-0046 §13).
 *
 * So the two suites are not duplicates. This one asks "does `mergeColumns`
 * honour declaration order"; that one asks "does the demo resource, labelled
 * from `common:options`, come out the way the screens expect". Neither can
 * answer the other's question.
 *
 * The fixtures here are inline and minimal on purpose: a package that borrowed
 * the app's demo config would be a package importing from an app, which is the
 * one thing this deliverable's done-when forbids outright.
 */

const columns = {
  name: { header: "demo:columns.name", sortable: true },
  status: { header: "demo:columns.status" },
  createdAt: { header: "demo:columns.createdAt" },
} as unknown as ColumnConfigMap;

describe("humanize", () => {
  it("renders a snake_case identifier as a sentence", () => {
    expect(humanize("super_admin")).toBe("Super admin");
  });

  it("leaves a value it cannot improve alone", () => {
    expect(humanize("Active")).toBe("Active");
  });
});

describe("mergeColumns", () => {
  // It returns *entries*, not an object: the column order is the declaration
  // order and an array is the only shape that carries it.
  const names = (merged: readonly (readonly [string, unknown])[]) =>
    merged.map(([name]) => name);

  it("keeps declaration order, because that is the column order", () => {
    expect(names(mergeColumns(columns, {}))).toEqual([
      "name",
      "status",
      "createdAt",
    ]);
  });

  it("lets a usage override one key without restating the column", () => {
    const merged = mergeColumns(columns, { name: { sortable: false } });
    const name = merged.find(([key]) => key === "name")?.[1];

    expect(name?.sortable).toBe(false);
    // The rest of the column survives the override.
    expect(name?.header).toBe("demo:columns.name");
  });

  it("drops a column a usage hides", () => {
    expect(names(mergeColumns(columns, { status: { hidden: true } }))).toEqual([
      "name",
      "createdAt",
    ]);
  });

  it("ignores an override for a column the resource does not declare", () => {
    expect(
      names(mergeColumns(columns, { nothere: { sortable: true } })),
    ).toEqual(["name", "status", "createdAt"]);
  });
});

describe("optionValues", () => {
  it("reads the values with no translator, which is what keeps it pure", () => {
    expect(optionValues(["active", "disabled"])).toEqual([
      "active",
      "disabled",
    ]);
  });
});

describe("resolveOptions", () => {
  /*
   * A translator that echoes its `defaultValue`, which is exactly the contract
   * `config.ts` relies on: every dynamic `common:options.*` lookup passes
   * `humanize(value)` as the default, so a value the catalogue has never heard
   * of degrades to the pre-D7 wording rather than to a raw key. Asserting that
   * here needs no catalogue at all — only a translator that behaves like one.
   */
  const missing = ((_key: string, options?: { defaultValue?: string }) =>
    options?.defaultValue ?? "") as unknown as TranslateKey;

  it("falls back to humanize for a value the catalogue has never heard of", () => {
    expect(resolveOptions(["super_admin"], missing)).toEqual([
      { value: "super_admin", label: "Super admin" },
    ]);
  });
});
