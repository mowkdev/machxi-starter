import type { BodySchemaLike, SchemaLike } from "../contract";

/**
 * A list endpoint and two request bodies, in miniature (`D14.10`).
 *
 * `assertConfigMatchesContract` is the only thing standing between a resource's
 * config and its API now that the per-resource suites are gone, so it needs a
 * suite of its own — and one that can be made to *refuse* things, which the real
 * contracts cannot be. These fakes implement `safeParse` structurally, the same
 * way the assertion consumes it, so what the tests exercise is the wiring rather
 * than a mock of zod.
 *
 * The rules below are ADR-0014's, narrowed to what a config can claim: a sort is
 * a field name with an optional `-`, a filter is a field with an operator, and
 * `q` exists or it does not.
 */

export interface FakeEndpoint {
  readonly sortable: readonly string[];
  /** Field → the operators the endpoint allow-lists for it. */
  readonly filterable: Readonly<Record<string, readonly string[]>>;
  /** Field → the values it accepts, for the enum ones. */
  readonly values?: Readonly<Record<string, readonly string[]>>;
  readonly searchable: boolean;
}

const failure = (message: string) => ({
  success: false,
  error: { issues: [message] },
});

const ok = { success: true } as const;

export const fakeListQuery = (endpoint: FakeEndpoint): SchemaLike => ({
  safeParse: (value: unknown) => {
    const query = (value ?? {}) as Record<string, unknown>;

    if (typeof query["sort"] === "string") {
      const field = query["sort"].replace(/^-/, "");

      if (!endpoint.sortable.includes(field))
        return failure(`sort by \`${field}\` is not allow-listed`);
    }

    if (query["q"] !== undefined && !endpoint.searchable)
      return failure("this endpoint has no `q`");

    const filter = (query["filter"] ?? {}) as Record<string, unknown>;

    for (const [field, operand] of Object.entries(filter)) {
      const ops = endpoint.filterable[field];

      if (ops === undefined) return failure(`\`${field}\` is not filterable`);

      const written =
        typeof operand === "object" && operand !== null
          ? Object.entries(operand as Record<string, unknown>)
          : [["eq", operand] as const];

      for (const [op, term] of written) {
        if (!ops.includes(op))
          return failure(`\`${field}\` does not accept \`${op}\``);

        const allowed = endpoint.values?.[field];

        if (
          allowed !== undefined &&
          (op === "eq" || op === "in") &&
          !allowed.includes(String(term))
        )
          return failure(`\`${field}\` does not accept \`${String(term)}\``);
      }
    }

    return ok;
  },
});

export interface FakeBody {
  readonly required?: readonly string[];
  readonly optional?: readonly string[];
  /** Keys that accept `null` as "clear it" (ADR-0017's three requests). */
  readonly nullable?: readonly string[];
  /**
   * Keys that refuse `""` — `nameSchema` is `.trim().min(1)`.
   *
   * The third of the three requests, and the one that makes `initialValue: ""`
   * on a nullable field a form the API refuses on a control nobody touched.
   */
  readonly nonEmpty?: readonly string[];
}

/** A `strictObject`, structurally: unknown keys refused, required keys demanded. */
export const fakeBody = (body: FakeBody): BodySchemaLike => {
  const required = body.required ?? [];
  const known = [...required, ...(body.optional ?? [])];

  return {
    shape: Object.fromEntries(known.map((key) => [key, true])),
    safeParse: (value: unknown) => {
      const object = (value ?? {}) as Record<string, unknown>;

      for (const [key, operand] of Object.entries(object)) {
        if (!known.includes(key)) return failure(`unknown key \`${key}\``);
        if (operand === null && !(body.nullable ?? []).includes(key))
          return failure(`\`${key}\` is not nullable`);
        if (operand === "" && (body.nonEmpty ?? []).includes(key))
          return failure(`\`${key}\` may not be empty`);
      }

      for (const key of required)
        if (!(key in object)) return failure(`\`${key}\` is required`);

      return ok;
    },
  };
};
