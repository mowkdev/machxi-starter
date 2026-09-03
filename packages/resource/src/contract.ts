/**
 * The config against the contract, once, for every resource (ADR-0063 §2).
 *
 * Since `D14.10` the *vocabulary* half of ADR-0035's promise is the compiler's:
 * a column that is not a field of the row and a field neither body has room for
 * are compile errors on the lines that wrote them. What no type can reach is
 * the endpoint's **allow-lists** — `listStaffQuery` decides which of the row's
 * fields may be sorted on, which may be filtered and with which ADR-0014
 * operators, and none of that is expressible in `StaffResource`. So this is the
 * other half, and it is one function rather than one suite per resource.
 *
 * It replaces two hand-written suites of 367 and 412 lines. They were good
 * tests and stated their claim plainly; their weakness was that they had to be
 * **remembered** — nothing made the next resource write one, and a resource
 * with no suite had no check at all. A call the generator emits (`D14.11`) and
 * a reviewer can see missing is a different kind of promise.
 *
 * **Both directions, deliberately.** A column that *could* be sortable and is
 * not costs an operator a feature; a column that claims a sort the endpoint
 * refuses costs them a broken one, reported as a toast on a header that simply
 * never works. The negative controls are the ones worth the lines.
 *
 * It throws rather than calling `expect`, so it stays in the package's ordinary
 * source: `@repo/resource` has no test framework among its dependencies and
 * this buys it none. Every violation is collected and reported together —
 * failing on the first would hide the second, and a config being brought up to
 * a changed contract usually has more than one.
 */

import { fieldsForVariant, optionValues } from "./config";
import type {
  ColumnConfig,
  FieldConfig,
  FieldConfigMap,
  FilterControlConfig,
  HotFilterConfig,
  ResourceConfig,
  UnknownShape,
} from "./types";

/** Anything that parses — zod's `safeParse`, structurally. */
export interface SchemaLike {
  safeParse(value: unknown): {
    readonly success: boolean;
    readonly error?: { readonly issues?: unknown };
  };
}

/**
 * A request body, which is additionally asked for its keys.
 *
 * `shape` is what `z.strictObject` carries, and the required-fields claim below
 * derives the endpoint's requirements from it rather than restating them —
 * naming `email` and `password` by hand would be the test copying the contract
 * instead of checking against it. Optional, because a body that is not a plain
 * object still parses; the claim simply has nothing to walk.
 */
export interface BodySchemaLike extends SchemaLike {
  readonly shape?: object;
}

/** The endpoint a config claims to describe. */
export interface ResourceContract {
  /** The list endpoint's query schema — the allow-lists live here. */
  readonly listQuery: SchemaLike;
  readonly createBody: BodySchemaLike;
  readonly updateBody: BodySchemaLike;
  /**
   * Values the contract accepts for fields whose shape is domain knowledge.
   *
   * A `select` samples its own options and everything else samples a plain
   * word, which is right until the field is an email or a password. Fixture
   * data rather than a claim: what is being tested is the *set* of fields, and
   * a body cannot be assembled at all without values that parse.
   */
  readonly samples?: Readonly<Record<string, unknown>>;
  /**
   * Whether the app's catalogue labels an option value (ADR-0046 §7).
   *
   * The one claim that needs a dictionary, and a dictionary belongs to an app —
   * so the app answers the question and this asks it. `common:options.<value>`
   * is composed at runtime, deliberately, so that a config never restates an
   * enum ADR-0023 declares once; the cost is that a missing entry degrades to
   * `humanize`, which renders a plausible English word and is exactly the kind
   * of gap a review reads straight past. Absent skips the claim.
   */
  readonly optionLabelled?: (value: string) => boolean;
}

/**
 * What an operator has typed into a text control, from the field's sample.
 *
 * **A prefix, and that is the claim.** A text box is typed into character by
 * character, so the filter it writes has to accept a *partial* term — which is
 * exactly why `email` declares `like` and not `eq`: `filterable.email.value` is
 * `emailSchema`, which no prefix of an address satisfies, and ADR-0014 exempts
 * `like` from the field's value schema because a pattern is not a value of the
 * column's type. Probing `eq` with the whole sample would pass and say nothing,
 * because a valid email is of course a valid email.
 */
const typedInto = (term: string): string =>
  term.length > 3 ? term.slice(0, 3) : term;

/** A filter control as the query string it will write. */
const wireFilterFor = (
  field: string,
  filter: FilterControlConfig,
  term: string,
): Record<string, unknown> => {
  switch (filter.kind) {
    case "text": {
      // `like` writes an escaped containment pattern; `eq` writes the term.
      const typed = typedInto(term);

      return { [field]: filter.op === "like" ? { like: `%${typed}%` } : typed };
    }
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

/** A hot filter as the query string one press will write. */
const wireHotFilterFor = (config: HotFilterConfig): Record<string, unknown> => {
  if (config.kind === "presence")
    return { [config.field]: { null: String(config.value) } };

  const [first] = optionValues(config.options);

  return {
    [config.field]: config.op === "eq" ? (first ?? "") : { in: first ?? "" },
  };
};

/** Every option value a config declares, once each. */
const declaredOptions = (
  columns: readonly (readonly [string, ColumnConfig])[],
  fields: readonly (readonly [string, FieldConfig])[],
  hotFilters: readonly HotFilterConfig[],
): readonly string[] => [
  ...new Set([
    ...hotFilters.flatMap((filter) =>
      filter.kind === "enum" ? optionValues(filter.options) : [],
    ),
    ...fields.flatMap(([, field]) => optionValues(field.options)),
    ...columns.flatMap(([, column]) =>
      column.filter?.kind === "enum" ? optionValues(column.filter.options) : [],
    ),
  ]),
];

const issuesOf = (result: { readonly error?: { readonly issues?: unknown } }) =>
  JSON.stringify(result.error?.issues ?? null);

export const assertConfigMatchesContract = <
  TRow = UnknownShape,
  TCreate = UnknownShape,
  TUpdate = UnknownShape,
>(
  config: ResourceConfig<TRow, TCreate, TUpdate>,
  contract: ResourceContract,
): void => {
  const { listQuery, createBody, updateBody } = contract;
  const columns = Object.entries(
    config.columns as Readonly<Record<string, ColumnConfig>>,
  );
  const byName = config.fields as Readonly<
    Record<string, FieldConfig | undefined>
  >;
  const fields = Object.entries(byName).flatMap(([name, field]) =>
    field === undefined ? [] : [[name, field] as const],
  );
  const grid = config.grid;
  const hotFilters = grid?.hotFilters ?? [];
  const problems: string[] = [];
  const fail = (claim: string) => problems.push(claim);

  const sampleFor = (name: string, field: FieldConfig | undefined): unknown => {
    if (contract.samples !== undefined && name in contract.samples)
      return contract.samples[name];

    const options = optionValues(field?.options);

    switch (field?.component) {
      case "multiCheckbox":
        return [options[0] ?? ""];
      case "select":
        return options[0] ?? "";
      case "checkbox":
      case "switch":
        return true;
      default:
        return "Sample";
    }
  };

  for (const [name, column] of columns) {
    /*
     * Descending too: the header cycles through both, and a field the
     * allow-list holds accepts either direction.
     */
    if (column.sortable === true) {
      if (!listQuery.safeParse({ sort: name }).success)
        fail(`column \`${name}\` declares \`sortable\`, the endpoint does not`);
      else if (!listQuery.safeParse({ sort: `-${name}` }).success)
        // Only when ascending worked: otherwise this is the same finding twice.
        fail(`column \`${name}\` cannot be sorted descending`);
    } else if (listQuery.safeParse({ sort: name }).success) {
      /*
       * The negative control, and the one that catches the cheaper mistake:
       * a column the endpoint *can* order by, offered no arrow. It reads as a
       * missing feature rather than as a bug, which is why nobody reports it.
       */
      fail(
        `column \`${name}\` declares no sort control, but the endpoint sorts by it`,
      );
    }

    if (column.filter !== undefined) {
      const term = String(sampleFor(name, byName[name]) ?? "sample");
      const parsed = listQuery.safeParse({
        filter: wireFilterFor(name, column.filter, term),
      });

      if (!parsed.success)
        fail(
          `column \`${name}\`'s ${column.filter.kind} filter is not allow-listed: ${issuesOf(parsed)}`,
        );

      if (column.filter.kind === "enum")
        for (const option of optionValues(column.filter.options)) {
          const one = listQuery.safeParse({
            filter: wireFilterFor(
              name,
              { ...column.filter, options: [option] },
              term,
            ),
          });

          if (!one.success)
            fail(
              `column \`${name}\` offers \`${option}\`, the endpoint does not`,
            );
        }
    }
  }

  /*
   * The same discipline the column filters get, and it earns its keep: ADR-0039
   * declared a `roles` hot filter for staff, which `listStaffQuery` has no entry
   * for because `staff_roles` is a join table. A button the API answers with a
   * `VALIDATION_ERROR` fails here rather than in front of an operator.
   */
  for (const filter of hotFilters) {
    const parsed = listQuery.safeParse({ filter: wireHotFilterFor(filter) });

    if (!parsed.success)
      fail(
        `hot filter on \`${filter.field}\` is not allow-listed: ${issuesOf(parsed)}`,
      );

    if (filter.kind !== "enum") continue;

    /*
     * Per option, not per group: a group is one button per option, and the
     * check above only ever exercises the first one. **One direction only**, and
     * deliberately — the allow-list is a zod enum inside the endpoint's schema
     * and there is no way to enumerate it from out here. Declaring fewer options
     * than the API allows costs an operator a choice; declaring one it refuses
     * costs them a button that always fails.
     */
    for (const option of optionValues(filter.options)) {
      const one = listQuery.safeParse({
        filter: wireHotFilterFor({ ...filter, options: [option] }),
      });

      if (!one.success)
        fail(
          `hot filter on \`${filter.field}\` offers \`${option}\`, the endpoint does not`,
        );
    }
  }

  /*
   * `q` is a property of the endpoint rather than of any column (ADR-0014), so
   * the resource declares it in its grid block and this is where the declaration
   * meets the schema — in both directions, because a search box over an endpoint
   * that has no `q` returns an unfiltered page and looks like a working one.
   */
  const searches = listQuery.safeParse({ q: "sample" }).success;

  if ((grid?.searchable === true) !== searches)
    fail(
      grid?.searchable === true
        ? "the grid declares `searchable`, the endpoint has no `q`"
        : "the endpoint accepts `q`, the grid does not offer the search box",
    );

  /*
   * `canBulkDelete` without `selectable` is dead data — there is no selection
   * for the button to act on — so it is refused here rather than left to render
   * a toolbar button with nothing to act on (ADR-0038). It is a runtime claim
   * rather than a type because the two flags are independently meaningful, and
   * expressing "B implies A" in the type would cost a discriminated union for
   * one rule.
   */
  if (grid?.canBulkDelete === true && grid.selectable !== true)
    fail("the grid declares `canBulkDelete` without `selectable`");

  /*
   * One widening, at the top of the reads rather than at each of them: the
   * argument types are keyed by the bodies since `D14.10` (ADR-0063 §1), and a
   * mapped type over unresolved type parameters is not an index signature, so
   * the readers this file shares with every app cannot walk one.
   */
  const variantNames = (variant: "create" | "edit"): readonly string[] =>
    fieldsForVariant(config.fields as FieldConfigMap, variant).map(
      ([name]) => name,
    );

  const bodyFor = (variant: "create" | "edit") =>
    Object.fromEntries(
      variantNames(variant).map(
        (name) => [name, sampleFor(name, byName[name])] as const,
      ),
    );

  /*
   * The bodies are `strictObject`s, so one parse proves both directions at
   * once: every field the form renders is accepted (no unknown key) and every
   * field the endpoint *requires* is rendered (nothing missing).
   */
  const created = createBody.safeParse(bodyFor("create"));

  if (!created.success)
    fail(`the create variant is not a \`createBody\`: ${issuesOf(created)}`);

  const edited = updateBody.safeParse(bodyFor("edit"));

  if (!edited.success)
    fail(`the edit variant is not an \`updateBody\`: ${issuesOf(edited)}`);

  /*
   * And the required keys one at a time, derived from the schema rather than
   * named by hand. A field the endpoint requires must be on the form — there is
   * no other way for an operator to supply it — and this fails for any future
   * required key nobody added a control for, which the parse above would report
   * only as a missing-field issue on a body nobody was looking at.
   *
   * The converse is deliberately not asserted: an optional key the form omits is
   * a product decision, and the users resource has one (`roles` — one member in
   * v1, so a control could only ever make the form invalid).
   */
  if (createBody.shape !== undefined) {
    const createNames = variantNames("create");

    for (const key of Object.keys(createBody.shape)) {
      const without = Object.fromEntries(
        Object.entries(bodyFor("create")).filter(([other]) => other !== key),
      );
      const required = !createBody.safeParse(without).success;

      if (required && !createNames.includes(key))
        fail(`\`${key}\` is required by the create body and has no field`);
    }
  }

  /*
   * An `errorFields` entry names a **box on screen**, and the type can only get
   * it half right: it constrains the name to one of the bodies' keys, which is
   * not the same as a field the config draws. A code mapped to a field nobody
   * declares sends the API's sentence nowhere — `applyServerErrors` sets it on a
   * control that does not exist — which is the failure this key exists to
   * prevent, arriving by a different door.
   */
  for (const [code, name] of Object.entries(config.errorFields ?? {}))
    if (typeof name === "string" && byName[name] === undefined)
      fail(
        `\`errorFields.${code}\` names \`${name}\`, which no field declares`,
      );

  /*
   * A `nullable` field submits `null` for an emptied control rather than `""`,
   * which is only meaningful if the body distinguishes the three requests it is
   * there for: leave it (absent), set it (a string), clear it (`null`).
   */
  for (const [name, field] of fields) {
    if (field.nullable !== true) continue;
    if (!updateBody.safeParse({ [name]: null }).success)
      fail(
        `field \`${name}\` is \`nullable\`, the update body refuses \`null\``,
      );

    /*
     * And the seed has to be a request the body accepts. `null` is the one that
     * makes an untouched control equal to its default; `""` looks equivalent and
     * is the third thing the contract distinguishes — `nameSchema` is
     * `.trim().min(1)`, so a form seeded `""` submits a value the API refuses on
     * a field the operator never touched.
     */
    if (
      field.initialValue !== undefined &&
      !updateBody.safeParse({ [name]: field.initialValue }).success
    )
      fail(
        `field \`${name}\` starts at ${JSON.stringify(field.initialValue)}, which the update body refuses`,
      );
  }

  if (contract.optionLabelled !== undefined)
    for (const option of declaredOptions(columns, fields, hotFilters))
      if (!contract.optionLabelled(option))
        fail(`option \`${option}\` has no \`common:options\` label`);

  if (problems.length > 0)
    throw new Error(
      `\`${config.name}\` does not match its contract:\n  - ${problems.join("\n  - ")}`,
    );
};
