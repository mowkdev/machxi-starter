import {
  createStaffBody,
  listStaffQuery,
  updateStaffBody,
} from "@repo/contracts";
import { describe, expect, it } from "vitest";

import { fieldsForVariant, resolveOptions } from "@/shared/resource/config";
import type {
  ColumnConfigMap,
  FieldConfigMap,
  FilterControlConfig,
} from "@/shared/resource/types";

import { staffResourceConfig } from "../staff.config";

/**
 * The config against the contract (ADR-0035 §Consequences, ADR-0036).
 *
 * This is the suite ADR-0035 promises when it says the agreement is "testable
 * rather than trusted", and D3.6 could not write it: the demo resource had no
 * endpoint to check against, so staff is the first config with a real one.
 *
 * The claim under test is narrow and worth stating plainly. Every `sortable`
 * and every `filter` in the config is an **assertion about `listStaffQuery`**,
 * and every field in the config is an assertion about `createStaffBody` or
 * `updateStaffBody`. Nothing else validates them: the grid renders a sort arrow
 * because the config said so, and the API refuses the resulting request because
 * the contract says otherwise — an operator would meet that as a toast on a
 * column that simply never works. Here it is a red test on the same line that
 * caused it.
 *
 * Both directions matter, which is why the negative controls are here too: a
 * column that *could* be sortable and is not costs an operator a feature, but a
 * column that claims it and is not costs them a broken one.
 */

/*
 * Widened to the vocabulary's own types. The config is `as const satisfies
 * ResourceConfig`, which is what `createAppFormInput` needs — but it also means
 * each column's type is a literal with only the keys that column happens to
 * declare, so `column.filter` is a compile error on the ones that have none.
 * The annotation asks the questions this file is about: does *this* column
 * declare a filter, and does the contract allow it.
 */
const columns: ColumnConfigMap = staffResourceConfig.columns;
const fields: FieldConfigMap = staffResourceConfig.fields;

const columnsWith = <TKey extends "sortable" | "filter">(key: TKey) =>
  Object.entries(columns).filter(([, column]) => column[key] !== undefined);

/** A filter control as the query string it will write. */
const wireFilterFor = (
  field: string,
  filter: FilterControlConfig,
): Record<string, unknown> => {
  switch (filter.kind) {
    case "text":
      // `like` writes an escaped containment pattern; `eq` writes the term.
      return {
        [field]: filter.op === "like" ? { like: "%ada%" } : "ada@machxi.local",
      };
    case "enum": {
      const [first] = resolveOptions(filter.options);

      // A bare `filter[x]=v` *is* `eq` (ADR-0014), which is the form the
      // control writes and therefore the form to check.
      return {
        [field]:
          filter.op === "eq"
            ? (first?.value ?? "")
            : { in: first?.value ?? "" },
      };
    }
    case "dateRange":
      return {
        [field]: {
          [filter.from]: "2026-01-01T00:00:00.000Z",
          [filter.to]: "2026-02-01T23:59:59.999Z",
        },
      };
    case "presence":
      return { [field]: { null: String(filter.value) } };
  }
};

describe("the staff grid config against listStaffQuery", () => {
  it.each(columnsWith("sortable"))(
    "%s declares `sortable` and the endpoint allows sorting by it",
    (name) => {
      expect(listStaffQuery.safeParse({ sort: name }).success).toBe(true);
      // Descending too: the header cycles through both, and a field the
      // allow-list holds accepts either direction.
      expect(listStaffQuery.safeParse({ sort: `-${name}` }).success).toBe(true);
    },
  );

  it.each(
    Object.entries(columns).filter(([, column]) => column.sortable !== true),
  )("%s declares no sort control, and the endpoint refuses one", (name) => {
    // The negative control. `roles` resolves to a join table and `actions` to
    // nothing at all; a config that quietly grew `sortable: true` on either
    // would render an arrow that answers `VALIDATION_ERROR`.
    expect(listStaffQuery.safeParse({ sort: name }).success).toBe(false);
  });

  it.each(columnsWith("filter"))(
    "%s declares a filter the endpoint allow-lists, field and operator",
    (name, column) => {
      const filter = column.filter;

      if (filter === undefined) throw new Error("unreachable");

      const parsed = listStaffQuery.safeParse({
        filter: wireFilterFor(name, filter),
      });

      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    },
  );

  it("keeps the email filter off `eq`, which the field's value schema would reject", () => {
    /*
     * Not a restatement of the config — a record of *why* it says `like`.
     * `filterable.email.value` is `emailSchema`, so an `eq` control would
     * refuse every partial term an operator types; `like` is exempt from the
     * field's value schema because a pattern is not a value of the column's
     * type (ADR-0014).
     */
    expect(listStaffQuery.safeParse({ filter: { email: "ada" } }).success).toBe(
      false,
    );
    expect(
      listStaffQuery.safeParse({ filter: { email: { like: "%ada%" } } })
        .success,
    ).toBe(true);
  });
});

describe("the staff form config against the request bodies", () => {
  it("creates with exactly the fields the create variant declares", () => {
    const names = fieldsForVariant(fields, "create").map(([name]) => name);

    const parsed = createStaffBody.safeParse(
      Object.fromEntries(names.map((name) => [name, sampleFor(name)] as const)),
    );

    /*
     * `createStaffBody` is a `strictObject`, so this one parse proves both
     * directions at once: every field the form renders is accepted (no unknown
     * key) and every field the endpoint requires is rendered (nothing missing).
     * A config that forgot `roles`, or grew a `department` nobody added to
     * contracts, fails here.
     */
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("edits with exactly the fields the edit variant declares", () => {
    const names = fieldsForVariant(fields, "edit").map(([name]) => name);

    const parsed = updateStaffBody.safeParse(
      Object.fromEntries(names.map((name) => [name, sampleFor(name)] as const)),
    );

    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("keeps email and password out of the edit form, because the body has no room for them", () => {
    // The other half of the strict-object argument, stated rather than implied:
    // `updateStaffBody` omits `email` by design (ADR-0017 — changing the
    // identifier a session was established with is its own flow) and has never
    // had a password field (ADR-0027). If the config moved either into the edit
    // variant, the test above would fail; this says what that failure means.
    const editNames = fieldsForVariant(fields, "edit").map(([name]) => name);

    expect(editNames).not.toContain("email");
    expect(editNames).not.toContain("password");
    expect(
      updateStaffBody.safeParse({ email: "ada@machxi.local" }).success,
    ).toBe(false);
  });
});

/** A value the contract accepts for a field, chosen from the config's own options. */
const sampleFor = (name: string): unknown => {
  const field = fields[name];
  const options = resolveOptions(field?.options);

  switch (field?.component) {
    case "multiCheckbox":
      return [options[0]?.value ?? ""];
    case "select":
      return options[0]?.value ?? "";
    default:
      return name === "email"
        ? "new.operator@machxi.local"
        : name === "password"
          ? "DevPassword!123"
          : "Sample";
  }
};
