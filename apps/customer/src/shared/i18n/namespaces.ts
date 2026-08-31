/**
 * The namespaces this app's catalogues are cut into (ADR-0046 §3).
 *
 * **The namespace name _is_ the slice name**, the rule `D7.4` set for the
 * admin and ADR-0055 §2 carries here: `features/auth` writes `t("auth:…")` and
 * nothing else, and a key under `auth:` appearing in another slice is a review
 * finding rather than a failed build — ADR-0049's import lint cannot see a
 * string prefix, and ADR-0046 says so rather than pretending it can.
 *
 * Four since `D12.2`, and the list is meant to be read as the app's own rather
 * than as a subset of the admin's: `common` is chrome, `auth` is the sign-in
 * screen, `errors` is keyed by `ErrorCode` (ADR-0046 §2, and completeness is
 * checked by the compiler in `__checks__/errors.ts`), and `home` is the signed-in
 * landing screen — **not** `dashboard`, which is what the admin calls its own and
 * is the wrong word for a customer looking at their own account.
 *
 * `form` arrives with the first form at `D12.6`, and `account`/`profile`/`settings`
 * with the account area. There is deliberately **no `grid`** — ADR-0055 §3 keeps
 * `@repo/grid` out of this app until a domain entity arrives, and a namespace
 * declared for a package the app does not depend on is one `init` would fail to
 * load.
 *
 * Its own module rather than part of the barrel, for the reason the admin's is:
 * `resources.ts` needs the list and `index.ts` needs both, so leaving the list
 * in the barrel would make them a cycle.
 */
export const NAMESPACES = ["common", "errors", "auth", "home"] as const;

export type Namespace = (typeof NAMESPACES)[number];

/** `common` is chrome and generic actions, so it is what an unprefixed key means. */
export const DEFAULT_NAMESPACE = "common" satisfies Namespace;
