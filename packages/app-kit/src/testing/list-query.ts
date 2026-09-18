/**
 * The ADR-0014 wire form, read back the way the API reads it (ADR-0036).
 *
 * A handler that pulled `offset` out of `URLSearchParams` and ignored the rest
 * would let the suite certify a request the API would refuse — the exact class
 * of dishonesty the "handlers are built from `@repo/contracts`" rule exists to
 * close. Express parses `filter[status][in]=a,b` into a nested object before
 * `validate()` sees it; `msw` hands over a flat `URLSearchParams`, so the
 * nesting has to be rebuilt before the endpoint's own `listQuerySchema` can
 * judge it.
 *
 * The result is that a caller asking to sort by a field, or filter with an
 * operator, that its endpoint's contract does not allow-list makes the
 * *handler* throw, in the test that renders the screen, rather than reaching a
 * person as a `VALIDATION_ERROR`.
 *
 * **How far the `qs` fidelity goes**, stated because two suites now stand on
 * it: over the form `stringifyListSearch` emits — bracket nesting, and a
 * multi-valued operator as one comma list — this agrees with `qs`. It does
 * **not** agree on a *repeated* key: `?sort=a&sort=b` is `{ sort: "b" }` here
 * and `["a", "b"]` under `qs`. Nothing in this repository emits that form, and
 * last-wins is what `URLSearchParams` hands over; the divergence is recorded
 * rather than closed, because closing it would mean building the array shape
 * no contract accepts.
 *
 * **Moved here at `D20.10`** (ADR-0062 §1, the harness third of the review's
 * FE-04), beside `envelope.ts` and on the same argument the copy in
 * `apps/customer` had been carrying since `D15.5`: it holds no app knowledge
 * at all — no segment, no fixture, no route — and "the step that promotes one
 * should promote both" is what that comment asked for.
 */

/** `filter[createdAt][gte]` → `["filter", "createdAt", "gte"]`. */
const segmentsOf = (key: string): readonly string[] => {
  const [root = key, ...rest] = key.split("[");

  return [root, ...rest.map((segment) => segment.replace(/\]$/, ""))];
};

/** `?a=1&filter[x][gte]=2` → `{ a: "1", filter: { x: { gte: "2" } } }`. */
export const nestSearchParams = (
  search: URLSearchParams,
): Record<string, unknown> => {
  const root: Record<string, unknown> = {};

  for (const [key, value] of search.entries()) {
    const segments = segmentsOf(key);
    let cursor = root;

    for (const [index, segment] of segments.entries()) {
      if (index === segments.length - 1) {
        cursor[segment] = value;
        break;
      }

      const existing = cursor[segment];
      const next =
        typeof existing === "object" && existing !== null
          ? (existing as Record<string, unknown>)
          : {};

      cursor[segment] = next;
      cursor = next;
    }
  }

  return root;
};

/**
 * A request URL parsed by an endpoint's own query schema.
 *
 * Structurally typed on `parse` rather than on `z.ZodType`, because
 * `listQuerySchema` returns a transform pipeline whose input type is `unknown`
 * — naming the zod type here would pin this helper to a zod internal for no
 * gain, while `parse` is the whole contract it needs.
 */
export const parseListSearch = <T>(
  url: string,
  schema: { readonly parse: (input: unknown) => T },
): T => schema.parse(nestSearchParams(new URL(url).searchParams));
