/**
 * The one place a profile query key is built (ADR-0034 §Query keys).
 *
 * A singleton has one entry, so this is the smallest key factory this app
 * could have — and it still exists rather than being an inline `["profile"]` at
 * the call site, because a key written twice is an invalidation that misses,
 * and the miss is silent.
 *
 * `all` is the prefix every mutation here invalidates; `detail()` is the entry
 * the query occupies. They are separate so that a later `/profile/sessions`
 * list would hang off `all` without any existing invalidation having to learn
 * about it.
 */
export const profileKeys = {
  all: ["profile"] as const,
  detail: () => [...profileKeys.all, "detail"] as const,
} as const;
