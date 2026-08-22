import {
  createStaffBody,
  listStaffQuery,
  updateStaffBody,
} from "@repo/contracts";
import { describe, expect, it } from "vitest";

import { EN_RESOURCES, NAMESPACES, createI18n } from "@/shared/i18n";
import { fieldsForVariant, optionValues } from "@/shared/resource/config";
import type {
  ColumnConfigMap,
  GridConfig,
  FieldConfigMap,
  FilterControlConfig,
  HotFilterConfig,
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
      const [first] = optionValues(filter.options);

      // A bare `filter[x]=v` *is* `eq` (ADR-0014), which is the form the
      // control writes and therefore the form to check.
      return {
        [field]: filter.op === "eq" ? (first ?? "") : { in: first ?? "" },
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
  const options = optionValues(field?.options);

  switch (field?.component) {
    case "multiCheckbox":
      return [options[0] ?? ""];
    case "select":
      return options[0] ?? "";
    default:
      return name === "email"
        ? "new.operator@machxi.local"
        : name === "password"
          ? "DevPassword!123"
          : "Sample";
  }
};

describe("the staff grid config block against ADR-0038 and ADR-0039", () => {
  const grid: GridConfig | undefined = staffResourceConfig.grid;

  it("declares selection wherever it declares a bulk action", () => {
    /*
     * `canBulkDelete` without `selectable` is dead data — there is no selection
     * for the button to act on — so the config test refuses the combination
     * rather than letting the toolbar quietly render nothing (ADR-0038).
     *
     * It is checked here rather than in the type because the two flags are
     * independently meaningful: a resource may be selectable with no bulk
     * action at all, and expressing "B implies A" in the type would cost a
     * discriminated union for one rule.
     */
    if (grid?.canBulkDelete === true) expect(grid.selectable).toBe(true);
  });

  it("declares capabilities and a shell, and nothing that names a role", () => {
    /*
     * A capability is not a permission (ADR-0038, ADR-0042). The flags here are
     * what this *surface offers*; every discretionary one is conjoined with
     * `can()` above the grid, and the API's guards remain the enforcement
     * either way — so a role, a principal or a permission string appearing in
     * this block would be the config having taken an access-control decision,
     * which ADR-0038 predicts somebody eventually tries.
     *
     * The key set is asserted rather than a `some(key.includes("role"))`
     * predicate, which was the first version of this test and could not fail:
     * no `GridConfig` key could contain "role", and the type forbids adding
     * one. An exact set does catch a smuggled key, and it also catches a
     * capability being added here without a decision about who may use it.
     */
    expect(Object.keys(grid ?? {}).sort()).toEqual([
      "canBulkDelete",
      "canCreate",
      "canDelete",
      "canEdit",
      "editSurface",
      "hotFilters",
      "selectable",
    ]);
  });
});

/** A hot filter as the query string one press will write. */
const wireHotFilterFor = (config: HotFilterConfig): Record<string, unknown> => {
  if (config.kind === "presence")
    return { [config.field]: { null: String(config.value) } };

  const [first] = optionValues(config.options);

  return {
    [config.field]: config.op === "eq" ? (first ?? "") : { in: first ?? "" },
  };
};

describe("the staff hot filters against listStaffQuery", () => {
  const hotFilters: readonly HotFilterConfig[] =
    staffResourceConfig.grid.hotFilters;

  /*
   * The same discipline the column filters get, and the reason it earns its
   * keep here: ADR-0039's own example declares a `roles` hot filter for staff,
   * which `listStaffQuery.filterable` has no entry for — `staff_roles` is a
   * join table. A button the API answers with a `VALIDATION_ERROR` fails here
   * rather than in front of an operator, which is the whole argument for
   * declaring hot filters as config instead of composing them per page.
   */
  it.each(hotFilters.map((config) => [config.field, config] as const))(
    "%s presses into a filter the endpoint allow-lists, field and operator",
    (_field, config) => {
      const parsed = listStaffQuery.safeParse({
        filter: wireHotFilterFor(config),
      });

      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    },
  );

  it("declares only options the endpoint accepts", () => {
    /*
     * Per option, not per group: a group is one button per option, and an
     * option outside the field's value schema is a button that always fails.
     * The sample in the case above only ever exercises the first one.
     *
     * **One direction only, and the name says so.** This cannot also assert
     * that the contract accepts *nothing else* — the allow-list is a zod enum
     * inside the endpoint's schema and there is no way to enumerate it from
     * out here. Declaring fewer options than the API allows costs an operator a
     * choice; declaring one it refuses costs them a button that always fails,
     * and that is the direction worth a test.
     */
    for (const config of hotFilters) {
      if (config.kind !== "enum") continue;

      for (const option of optionValues(config.options)) {
        // Through the same builder the case above uses, so an `in` group is
        // probed as `in` rather than silently as the `eq` shorthand.
        const parsed = listStaffQuery.safeParse({
          filter: wireHotFilterFor({ ...config, options: [option] }),
        });

        expect(parsed.success, `${config.field} = ${option}`).toBe(true);
      }
    }
  });
});

describe("the staff config's copy is keys, and the keys resolve", () => {
  /*
   * The compiler owns most of this: `header`, `label`, `description`,
   * `placeholder` and a hot filter's `label` are `TranslationKey`s since
   * `D7.4`, so a misspelled key is a failed `check-types` at the line that
   * wrote it (asserted below with `@ts-expect-error`, which is how this file
   * already asserts the registry keys).
   *
   * What it does **not** own is `common:options.<value>`: that key is composed
   * at runtime from the contracts tuple, deliberately, so that a config never
   * restates an enum ADR-0023 declares once — and a value with no catalogue
   * entry degrades silently to `humanize`, which is a plausible English word
   * and therefore the kind of gap a review reads straight past. So it gets a
   * test.
   */
  const t = createI18n({
    resources: { en: EN_RESOURCES },
    namespaces: NAMESPACES,
    locale: "en",
  }).instance.getFixedT(null, "common");

  const declaredOptions = [
    ...new Set(
      [
        ...staffResourceConfig.grid.hotFilters.flatMap((config) =>
          config.kind === "enum" ? optionValues(config.options) : [],
        ),
        ...Object.values(fields).flatMap((field) =>
          optionValues(field.options),
        ),
        ...Object.values(columns).flatMap((column) =>
          column.filter?.kind === "enum"
            ? optionValues(column.filter.options)
            : [],
        ),
      ].flat(),
    ),
  ];

  it.each(declaredOptions)("catalogues the option label for `%s`", (value) => {
    expect(t(`options.${value}` as "options.active")).not.toBe(
      `options.${value}`,
    );
  });

  it("makes a misspelled key a compile error rather than a blank header", () => {
    const typo = {
      email: {
        // @ts-expect-error `colums` — the property `TranslationKey` exists to
        // buy, and `pnpm check-types` is what asserts it (ADR-0046 §7).
        header: "staff:colums.email",
      },
    } satisfies ColumnConfigMap;

    expect(Object.keys(typo)).toHaveLength(1);
  });
});
