/**
 * The namespaces this app's catalogues are cut into (ADR-0046 §3).
 *
 * **The namespace name _is_ the slice name.** `features/staff-manage` and
 * `entities/staff` write `t("staff:…")` and nothing else, and a key under
 * `staff:` appearing in `features/users-manage` is a review finding rather than
 * a failed build — ADR-0032's import lint cannot see a string prefix, and
 * ADR-0046 says so rather than pretending it can.
 *
 * The first four are the cross-cutting ones `D7.1` created and `D7.2` filled:
 * they belong to `shared/*` and are the four that move with it when D8 lifts
 * the machinery into packages. The ones after them are `D7.4`'s rule — one per
 * slice that owns operator copy — and they grow with the slices: `settings`
 * covers the appearance control and the locale switch `D7.5` put beside it,
 * and `account` is `D11.9`'s, the area's own name and its section labels.
 *
 * **Its own module since `D7.4`**, for the reason `tags.ts` got one at `D7.2`:
 * `keys.ts` needs the list and `index.ts` needs `keys.ts`, so leaving the list
 * in the barrel would make the two a cycle. `index.ts` re-exports it, so
 * nothing outside `shared/i18n` learns the difference.
 */
export const NAMESPACES = [
  "common",
  /*
   * **`grid` and `form` are declared here but their catalogues are not this
   * app's** since `D9.4` and `D9.5`: `@repo/grid` and `@repo/form` each ship
   * their own namespace and hand it over (ADR-0046 §13). The name stays in this list because the instance
   * must still *load* it — `createI18n` passes the list to `init`, and a
   * namespace absent from it is one `useKeyT` would not bind to.
   */
  "grid",
  "form",
  // `@repo/account`'s own (`D22.2`, ADR-0077 §2), declared for the reason
  // `form` is: the instance must still load it.
  "accountClient",
  "errors",
  "auth",
  "dashboard",
  "profile",
  "staff",
  "users",
  "settings",
  /*
   * `pages/account`'s own (`D11.9`, ADR-0053 §1): the area's title, the
   * section nav's accessible name and the three section labels. The sections'
   * *contents* keep the namespaces they already had — the profile and
   * password cards are still `profile:`, and `D11.10`'s preferences will be
   * `settings:` — because a section is an address, not an owner of copy.
   */
  "account",
  "organizations",
] as const;

export type Namespace = (typeof NAMESPACES)[number];

/** `common` is chrome and generic actions, so it is what an unprefixed key means. */
export const DEFAULT_NAMESPACE = "common" satisfies Namespace;
