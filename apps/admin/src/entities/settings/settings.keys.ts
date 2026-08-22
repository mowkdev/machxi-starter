/**
 * The one place a settings query key is built (ADR-0043 §Query keys).
 *
 * A singleton, like the profile: the subject is `ctx.principal`, so there is
 * one entry and no `detail(id)` to build. It is still a factory rather than an
 * inline `["settings"]` at the call site, for the reason `profileKeys` gives —
 * a key written twice is an invalidation that misses, and the miss is silent.
 *
 * `all` is what the update mutation invalidates; `detail()` is the entry the
 * bootstrap query occupies. Kept apart so that a later per-grid endpoint, or
 * D7's locale surface, hangs off `all` without any existing invalidation
 * having to learn about it.
 */
export const settingsKeys = {
  all: ["settings"] as const,
  detail: () => [...settingsKeys.all, "detail"] as const,
} as const;
