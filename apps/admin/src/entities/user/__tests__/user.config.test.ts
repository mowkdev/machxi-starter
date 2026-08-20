import {
  createUserBody,
  listUsersQuery,
  updateUserBody,
} from "@repo/contracts";
import { describe, expect, it } from "vitest";

import { fieldsForVariant, resolveOptions } from "@/shared/resource/config";
import type {
  ColumnConfigMap,
  GridConfig,
  FieldConfigMap,
  FilterControlConfig,
} from "@/shared/resource/types";

import { userResourceConfig } from "../user.config";

/**
 * The users config against the contract (ADR-0035 §Consequences, ADR-0036).
 *
 * The same suite the staff config carries, against a different endpoint — and
 * that repetition is the point rather than a smell: each config makes claims
 * about *its own* schema, and a shared assertion would have to be given both
 * halves anyway. What differs is the interesting part, and it is all here: a
 * `presence` filter, a column that is filterable but **not** sortable, and a
 * create body whose optional fields make one direction of the strict-object
 * argument weaker than it is for staff.
 */

// Widened to the vocabulary's types: the config is `as const satisfies
// ResourceConfig`, so each column's literal type has only the keys it declares.
const columns: ColumnConfigMap = userResourceConfig.columns;
const fields: FieldConfigMap = userResourceConfig.fields;

const columnsWith = (key: "sortable" | "filter") =>
  Object.entries(columns).filter(([, column]) => column[key] !== undefined);

/** A filter control as the query string it will write. */
const wireFilterFor = (
  field: string,
  filter: FilterControlConfig,
): Record<string, unknown> => {
  switch (filter.kind) {
    case "text":
      return {
        [field]:
          filter.op === "like" ? { like: "%cara%" } : "cara@example.test",
      };
    case "enum": {
      const [first] = resolveOptions(filter.options);

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

describe("the users grid config against listUsersQuery", () => {
  it.each(columnsWith("sortable"))(
    "%s declares `sortable` and the endpoint allows sorting by it",
    (name) => {
      expect(listUsersQuery.safeParse({ sort: name }).success).toBe(true);
      expect(listUsersQuery.safeParse({ sort: `-${name}` }).success).toBe(true);
    },
  );

  it.each(
    Object.entries(columns).filter(([, column]) => column.sortable !== true),
  )("%s declares no sort control, and the endpoint refuses one", (name) => {
    expect(listUsersQuery.safeParse({ sort: name }).success).toBe(false);
  });

  it.each(columnsWith("filter"))(
    "%s declares a filter the endpoint allow-lists, field and operator",
    (name, column) => {
      const filter = column.filter;

      if (filter === undefined) throw new Error("unreachable");

      const parsed = listUsersQuery.safeParse({
        filter: wireFilterFor(name, filter),
      });

      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    },
  );

  it("filters `deletedAt` by presence and cannot sort by it", () => {
    /*
     * The one column in the app that is filterable and not sortable, and the
     * pair of assertions is why both directions of the test above exist.
     * `listUsersQuery` allow-lists `deletedAt` for `null` alone — the timestamp
     * is an internal soft-delete marker, but "show me the deleted ones" is a
     * real admin question (ADR-0017).
     */
    expect(columns["deletedAt"]?.sortable).toBeUndefined();
    expect(listUsersQuery.safeParse({ sort: "deletedAt" }).success).toBe(false);
    expect(
      listUsersQuery.safeParse({ filter: { deletedAt: { null: "false" } } })
        .success,
    ).toBe(true);
    // Not a comparison, either — the marker is a fact, not a range to query.
    expect(
      listUsersQuery.safeParse({
        filter: { deletedAt: { gte: "2026-01-01T00:00:00.000Z" } },
      }).success,
    ).toBe(false);
  });
});

describe("the users form config against the request bodies", () => {
  it("creates with exactly the fields the create variant declares", () => {
    const names = fieldsForVariant(fields, "create").map(([name]) => name);

    const parsed = createUserBody.safeParse(
      Object.fromEntries(names.map((name) => [name, sampleFor(name)] as const)),
    );

    /*
     * `createUserBody` is strict, so this proves no field the form renders is
     * unknown to the endpoint. It proves *less* than the staff equivalent in
     * the other direction — every field of `createStaffBody` is required, so
     * omitting one there fails; here only `email` and `password` are, so a
     * config that dropped `status` would still pass. That is a property of the
     * contract rather than a hole in the test, and the two checks below close
     * the gap from the contract's side.
     */
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it.each(Object.keys(createUserBody.shape))(
    "renders %s on the create form iff the endpoint requires it",
    (key) => {
      /*
       * Derived from the schema rather than naming `email` and `password` by
       * hand, which would restate the contract instead of checking against it.
       * A field the endpoint *requires* must be on the form — there is no other
       * way for an operator to supply it — and this fails for any future
       * required key nobody added a control for.
       *
       * The converse is deliberately not asserted: an optional key the form
       * omits is a product decision, and `roles` is one (see below).
       */
      const names = fieldsForVariant(fields, "create").map(([name]) => name);
      const withoutIt = Object.fromEntries(
        Object.keys(createUserBody.shape)
          .filter((other) => other !== key)
          .map((other) => [other, sampleFor(other)] as const),
      );
      const isRequired = !createUserBody.safeParse(withoutIt).success;

      if (isRequired) expect(names).toContain(key);
    },
  );

  it("edits with exactly the fields the edit variant declares", () => {
    const names = fieldsForVariant(fields, "edit").map(([name]) => name);

    const parsed = updateUserBody.safeParse(
      Object.fromEntries(names.map((name) => [name, sampleFor(name)] as const)),
    );

    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("declares the nullable names the way the contract distinguishes them", () => {
    /*
     * Three requests, three meanings, and the config has to be able to say all
     * of them: leave it (absent), set it (a string), clear it (`null`). `""` is
     * none of the three — `nameSchema` is `.trim().min(1)` — which is why the
     * fields are `nullable` and seeded `null` rather than `""`. Each form then
     * reads that state by its own body's rules: the edit form prunes to
     * `dirtyFields`, so `null` means "clear it"; the create form drops `null`
     * entirely, because its body has no "clear it" to express.
     */
    expect(fields["firstName"]?.nullable).toBe(true);
    expect(fields["firstName"]?.initialValue).toBeNull();

    expect(updateUserBody.safeParse({ firstName: null }).success).toBe(true);
    expect(updateUserBody.safeParse({ firstName: "Cara" }).success).toBe(true);
    expect(updateUserBody.safeParse({ firstName: "" }).success).toBe(false);
    // And on create, `null` is *not* a legal value — only absence is, which is
    // what pruning an untouched field produces.
    expect(
      createUserBody.safeParse({
        email: "new@example.test",
        password: "DevPassword!123",
        firstName: null,
      }).success,
    ).toBe(false);
    expect(
      createUserBody.safeParse({
        email: "new@example.test",
        password: "DevPassword!123",
      }).success,
    ).toBe(true);
  });

  it("offers no roles control, because there is nothing to choose", () => {
    /*
     * `USER_ROLES` has one member in v1 and `userRolesSchema` requires at least
     * one when the key is present, so a control could only ever be used to make
     * the form invalid. The column stays — an account's roles are worth
     * showing — and the service assigns the default (ADR-0017).
     */
    expect(Object.keys(fields)).not.toContain("roles");
    expect(columns["roles"]).toBeDefined();
    expect(updateUserBody.safeParse({ roles: [] }).success).toBe(false);
  });
});

/** A value the contract accepts for a field, chosen from the config's options. */
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
        ? "new.customer@example.test"
        : name === "password"
          ? "DevPassword!123"
          : "Sample";
  }
};

describe("the users grid capability block against ADR-0038", () => {
  const grid: GridConfig | undefined = userResourceConfig.grid;

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
      "selectable",
    ]);
  });
});
