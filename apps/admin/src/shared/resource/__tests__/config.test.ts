import { describe, expect, it } from "vitest";

import { demoResourceConfig } from "@/test/fixtures/demo-resource";

import {
  dirtyValuesOf,
  fieldsForVariant,
  humanize,
  initialValuesFor,
  mergeColumns,
  resolveOptions,
} from "../config";

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
  it("accepts a contracts enum tuple and labels it", () => {
    // The shape `STAFF_ROLES` and friends already have — passing one straight
    // through is what keeps a config from restating the enum.
    expect(resolveOptions(["super_admin", "editor"])).toEqual([
      { value: "super_admin", label: "Super admin" },
      { value: "editor", label: "Editor" },
    ]);
  });

  it("keeps an explicit label", () => {
    expect(resolveOptions([{ value: "x", label: "Custom" }])).toEqual([
      { value: "x", label: "Custom" },
    ]);
  });
});

describe("mergeColumns", () => {
  const columns = {
    email: { header: "Email", sortable: true },
    status: { header: "Status", cellRenderer: "statusBadge" },
  } as const;

  it("keeps declaration order, because that is the column order", () => {
    expect(mergeColumns(columns).map(([name]) => name)).toEqual([
      "email",
      "status",
    ]);
  });

  it("lets a usage override one key without restating the column", () => {
    const merged = mergeColumns(columns, { email: { header: "Address" } });

    expect(merged[0]?.[1]).toEqual({ header: "Address", sortable: true });
  });

  it("drops a column a usage hides", () => {
    const merged = mergeColumns(columns, { status: { hidden: true } });

    expect(merged.map(([name]) => name)).toEqual(["email"]);
  });

  it("ignores an override for a column the resource does not declare", () => {
    // Overrides adjust a resource's columns; they do not invent them, and an
    // invented one would have no field to read.
    const merged = mergeColumns(columns, { ghost: { header: "Ghost" } });

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
