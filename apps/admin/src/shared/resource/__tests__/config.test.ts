import { describe, expect, it } from "vitest";

import type { TranslateKey } from "@/shared/i18n";
import { demoResourceConfig } from "@/test/fixtures/demo-resource";
import { createTestI18n } from "@/test/render";

import {
  dirtyValuesOf,
  fieldsForVariant,
  humanize,
  initialValuesFor,
  mergeColumns,
  optionValues,
  resolveOptions,
} from "../config";
import type { ColumnConfigMap } from "../types";

/**
 * The config vocabulary's runtime half (ADR-0035).
 *
 * These are the functions that turn "a config is data" from a slogan into a
 * property: merging, filtering by variant and pruning to what changed are all
 * things a config of *functions* could not have been put through.
 */

describe("humanize", () => {
  it("renders a snake_case identifier as a sentence", () => {
    expect(humanize("super_admin")).toBe("Super admin");
    expect(humanize("pending_verification")).toBe("Pending verification");
    expect(humanize("active")).toBe("Active");
  });

  it("leaves a value it cannot improve alone", () => {
    expect(humanize("")).toBe("");
    expect(humanize("_")).toBe("_");
  });
});

describe("resolveOptions", () => {
  /*
   * A real instance, not a stub, so these tables assert the **catalogue's**
   * words (`D7.2`'s rule, applied to the option labels `D7.4` catalogued).
   */
  const t = createTestI18n().t as TranslateKey;

  it("accepts a contracts enum tuple and labels it from `common:options`", () => {
    // The shape `STAFF_ROLES` and friends already have — passing one straight
    // through is what keeps a config from restating the enum, which is the
    // whole reason the label is looked up by value rather than declared.
    expect(resolveOptions(["super_admin", "editor"], t)).toEqual([
      { value: "super_admin", label: "Super admin" },
      { value: "editor", label: "Editor" },
    ]);
  });

  it("falls back to `humanize` for a value the catalogue has never heard of", () => {
    // The pre-D7 behaviour, kept as the `defaultValue`: a member added to
    // `@repo/contracts` renders a plausible word rather than a raw key.
    expect(resolveOptions(["gamma_ray"], t)).toEqual([
      { value: "gamma_ray", label: "Gamma ray" },
    ]);
  });

  it("keeps an explicit label, which is now a key like every other", () => {
    expect(
      resolveOptions([{ value: "x", label: "common:options.active" }], t),
    ).toEqual([{ value: "x", label: "Active" }]);
  });
});

describe("optionValues", () => {
  it("reads the values with no translator, which is what keeps it pure", () => {
    // The half a config test and the hot filters' maths need: which values may
    // this control write, asked without a rendered tree (`D7.4`).
    expect(
      optionValues(["active", { value: "x", label: "common:options.active" }]),
    ).toEqual(["active", "x"]);
  });
});

describe("mergeColumns", () => {
  const columns = {
    email: { header: "demo:columns.name", sortable: true },
    status: { header: "demo:columns.status", cellRenderer: "statusBadge" },
  } as const;

  it("keeps declaration order, because that is the column order", () => {
    expect(mergeColumns(columns).map(([name]) => name)).toEqual([
      "email",
      "status",
    ]);
  });

  it("lets a usage override one key without restating the column", () => {
    const merged = mergeColumns(columns, {
      email: { header: "demo:columns.createdAt" },
    });

    expect(merged[0]?.[1]).toEqual({
      header: "demo:columns.createdAt",
      sortable: true,
    });
  });

  it("drops a column a usage hides", () => {
    const merged = mergeColumns(columns, { status: { hidden: true } });

    expect(merged.map(([name]) => name)).toEqual(["email"]);
  });

  it("ignores an override for a column the resource does not declare", () => {
    // Overrides adjust a resource's columns; they do not invent them, and an
    // invented one would have no field to read.
    const merged = mergeColumns(columns, {
      ghost: { header: "demo:columns.tags" },
    });

    expect(merged.map(([name]) => name)).toEqual(["email", "status"]);
  });
});

describe("fieldsForVariant", () => {
  it("includes a field with no variants in both forms", () => {
    const names = (variant: "create" | "edit") =>
      fieldsForVariant(demoResourceConfig.fields, variant).map(
        ([name]) => name,
      );

    expect(names("create")).toContain("name");
    expect(names("edit")).toContain("name");
  });

  it("honours a create-only and an edit-only field", () => {
    // The config has to tell the same story as the contract: an initial
    // password exists only on create, a status only on edit.
    const create = fieldsForVariant(demoResourceConfig.fields, "create").map(
      ([name]) => name,
    );
    const edit = fieldsForVariant(demoResourceConfig.fields, "edit").map(
      ([name]) => name,
    );

    expect(create).toContain("secret");
    expect(create).not.toContain("status");
    expect(edit).toContain("status");
    expect(edit).not.toContain("secret");
  });
});

describe("initialValuesFor", () => {
  it("seeds from the config, and never with undefined", () => {
    const values = initialValuesFor(demoResourceConfig.fields, "create");

    expect(values["tags"]).toEqual(["alpha"]);
    expect(values["featured"]).toBe(false);
    // No `initialValue` declared: `""` rather than `undefined`, or React takes
    // the control as uncontrolled and warns on the first keystroke.
    expect(values["notes"]).toBe("");
    expect(Object.values(values).every((value) => value !== undefined)).toBe(
      true,
    );
  });

  it("omits the fields the variant does not render", () => {
    expect(
      Object.keys(initialValuesFor(demoResourceConfig.fields, "edit")),
    ).not.toContain("secret");
  });
});

describe("dirtyValuesOf", () => {
  it("keeps only what the operator changed", () => {
    expect(
      dirtyValuesOf(
        { firstName: "Ada", lastName: "Lovelace" },
        { firstName: true },
      ),
    ).toEqual({ firstName: "Ada" });
  });

  it("keeps an array field, whose dirty flag is an array of booleans", () => {
    /*
     * The regression this exists for: RHF mirrors the *value's* shape in
     * `dirtyFields`, so a `=== true` test passes on every scalar field and
     * silently drops exactly the array ones — which for an edit form means the
     * one change the operator made never reaches the request.
     */
    expect(dirtyValuesOf({ roles: ["admin"] }, { roles: [true] })).toEqual({
      roles: ["admin"],
    });
  });

  it("drops an array whose members are all untouched", () => {
    expect(dirtyValuesOf({ roles: ["admin"] }, { roles: [false] })).toEqual({});
  });
});

describe("a config's copy is keys, and a misspelt one does not compile", () => {
  /*
   * The compiler owns this claim — `header`, `label`, `description`,
   * `placeholder` and a hot filter's `label` are `TranslationKey`s since `D7.4`
   * (ADR-0046 §7) — so `pnpm check-types` is what runs the case below, and the
   * `expect` is only here to give it a name in the report.
   *
   * It lives in this slice rather than in a resource's `__tests__` since
   * `D14.10`: the two per-resource suites are one call of
   * `assertConfigMatchesContract` now (ADR-0063 §2), and this is a claim about
   * the *vocabulary* rather than about staff or users — which is what this file
   * is, and what the demo fixture beside it is for.
   */
  it("makes a misspelt key a compile error rather than a blank header", () => {
    const typo = {
      name: {
        // @ts-expect-error `colums` — the property `TranslationKey` exists to
        // buy, asserted the way this repository asserts every other one.
        header: "demo:colums.name",
      },
    } satisfies ColumnConfigMap;

    expect(Object.keys(typo)).toEqual(["name"]);
  });
});
