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
 * The result is that a config declaring a sort field or an operator the
 * contract does not allow-list makes the *handler* throw, in the test that
 * renders the grid, rather than reaching an operator as a `VALIDATION_ERROR`.
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
