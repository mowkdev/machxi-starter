/**
 * How a personal organization is named and addressed (ADR-0067 §2).
 *
 * Three callers derive these values and they must agree exactly: the backfill
 * migration `0012_backfill_personal_organizations.sql`, which writes them in
 * SQL; the seeders, which write them for the fixture users; and the API's
 * organizations service, which writes them on every path that creates a user.
 * Two of the three are TypeScript, so they share these functions rather than a
 * convention — the SQL is the third expression of the same rule and is kept
 * honest by `packages/db/src/__tests__/backfill-personal-organizations.int.test.ts`
 * asserting the result rather than the expression.
 *
 * They live in `src/` rather than beside the seeders because the API may not
 * import `@repo/db/seeds` — that entry point is a CLI — and a second copy in
 * `apps/api` is exactly the drift this file exists to prevent.
 */

/**
 * The slug of a user's personal organization: `personal-<uuid>`.
 *
 * Deterministic, so a backfill and a re-run are idempotent without a journal
 * and two concurrent creates cannot mint two slugs for one account;
 * collision-free, so nothing retries against the partial unique index; and it
 * **leaks no address**, which is the half that made the choice — a slug is a
 * URL segment (ADR-0067 §6), and one derived from an address would put that
 * address in every pasted link (ADR-0020 §Enumeration).
 *
 * The `personal-` prefix is reserved in `slugSchema`, so a user cannot choose
 * one and make somebody's personal organization silently unwritable.
 */
export const personalOrganizationSlug = (userId: string): string =>
  `personal-${userId}`;

/** What a personal organization needs to know about the account that owns it. */
export interface PersonalOrganizationOwner {
  readonly id: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
}

/**
 * The organization's display name: the account's own name when it has one, its
 * address when it does not (both name columns are nullable, ADR-0017).
 *
 * The same `coalesce` the backfill migration writes in SQL.
 */
export const personalOrganizationName = (
  owner: PersonalOrganizationOwner,
): string => {
  const full = [owner.firstName, owner.lastName]
    .filter((part): part is string => part !== null && part.trim() !== "")
    .join(" ")
    .trim();

  return full === "" ? owner.email : full;
};
