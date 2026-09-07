import type { OrganizationResource } from "@repo/contracts";

import { DEVICE_KEY_PREFIX } from "@/shared/config";

/**
 * Which organization the caller is acting as (`D15.9`, ADR-0067 §6 as amended
 * 2026-09-07).
 *
 * **This is the only place that rule is written.** Every tenant page, the
 * switcher and the sidebar's links read it, which is what makes "two addresses,
 * one page" a property of the app rather than a convention each screen repeats:
 * a screen at `/` is acting as the personal organization and the same screen at
 * `/orgs/$orgSlug` is acting as that team, and neither page knows which of the
 * two mounted it.
 *
 * **The resolution is total, and §2's invariant is what makes it so.** Every
 * account has exactly one personal organization, so "no slug" has an answer
 * rather than a null branch — the private context is a real organization with a
 * real id, and a request made from an unprefixed screen carries that id in
 * `/user/orgs/:orgId/...` exactly as a team's screen carries the team's. The
 * API is untouched by any of this.
 *
 * **It answers from the cache and never fetches.** `GET /user/orgs` is in the
 * cache on every screen because the switcher renders in the shell, so a slug
 * outside the caller's memberships is a not-found the client decides **without
 * a request** — the URL rule of ADR-0067 §4 read from the browser, and the
 * property `D15.5` established that this step keeps. A resolver with a loader
 * would have made "you are not in that organization" a round trip whose timing
 * says whether the tenant exists.
 */

/**
 * **The pure core, and it is deliberately the whole of this file.**
 *
 * `useActiveOrganization` lives in `organization.queries.ts` beside every other
 * hook in this slice, and is two lines binding this core to the router's params
 * and the switcher's query. Keeping the decisions here rather than inside the
 * hook is what lets the suite be a `.ts` with no router and no DOM — and it is
 * also what keeps the module graph acyclic, since the query layer now reads
 * from this file and nothing here reads back.
 */

/** What a resolution can conclude, when it is not an organization. */
export type ActiveOrganizationState = "resolved" | "pending" | "missing";

export interface ActiveOrganization {
  /** The organization being acted as, once it is known. */
  readonly organization: OrganizationResource | undefined;
  readonly state: ActiveOrganizationState;
  /**
   * The slug in the URL, or `undefined` on an unprefixed screen.
   *
   * Carried through so a caller building a link does not have to read the
   * router a second time to find out whether it is standing in a team.
   */
  readonly slug: string | undefined;
}

/**
 * The four answers, in the order they are decided.
 *
 * The **pending** case is the one worth being careful about, and it is the
 * finding `D15.5` recorded on the screens this replaces: a list that has not
 * arrived and a list holding no such slug are different things, and rendering a
 * not-found for the first flashes a dead end on every cold load. So a resolution
 * is three-valued and the missing branch requires the list to have actually
 * arrived.
 *
 * `rows === undefined` means the list is still arriving. An empty array is a
 * genuine answer and not a pending one — though ADR-0067 §2's invariant means
 * an account can only see one while a write is in flight.
 */
export const resolveActiveOrganization = (
  rows: readonly OrganizationResource[] | undefined,
  slug: string | undefined,
): ActiveOrganization => {
  if (rows === undefined)
    return { organization: undefined, state: "pending", slug };

  if (slug === undefined) {
    /*
     * The private context. `find` rather than an index, because the API orders
     * by creation and the personal organization is not promised to be first —
     * and §2's invariant is what makes the `undefined` branch unreachable in
     * practice rather than a state this app has to draw a screen for.
     */
    const personal = rows.find((row) => row.kind === "personal");

    return personal === undefined
      ? { organization: undefined, state: "missing", slug }
      : { organization: personal, state: "resolved", slug };
  }

  const addressed = rows.find((row) => row.slug === slug);

  /*
   * A team's slug resolves; the **personal** organization's does not, and that
   * asymmetry is ADR-0067 §6's third bullet rather than an oversight. Only a
   * team is addressed: `/orgs/<personal slug>` and everything under it render
   * not-found, because the private context lives at the root and a derived
   * slug in the address bar is the thing the amendment exists to remove.
   */
  if (addressed === undefined || addressed.kind === "personal")
    return { organization: undefined, state: "missing", slug };

  return { organization: addressed, state: "resolved", slug };
};

/**
 * Where a device remembers the last context this principal acted in
 * (ADR-0046 §4's device-key precedent, ADR-0067 §6).
 *
 * **Namespaced by the principal's id**, which is the whole of the privacy
 * argument: two accounts sharing a browser do not inherit each other's last
 * tenant, and an **impersonated** session reads the customer's key rather than
 * the operator's — the principal is the customer being impersonated (ADR-0057
 * §4), so the key follows the person whose screens are being drawn.
 *
 * `DEVICE_KEY_PREFIX` rather than a literal, so a fork's brand and the two SPAs
 * on one origin stay separated by the mechanism `D14.7` built rather than by a
 * name written here (ADR-0064 §1).
 */
export const organizationStorageKey = (principalId: string): string =>
  `${DEVICE_KEY_PREFIX}.org.${principalId}`;

/**
 * The remembered slug, or `undefined`.
 *
 * Wrapped, because `localStorage` throws rather than returning `null` in a
 * browser configured to block site data — and a private window is not an error
 * state for a preference whose absence is already meaningful.
 */
export const readRememberedSlug = (principalId: string): string | undefined => {
  try {
    return (
      globalThis.localStorage?.getItem(organizationStorageKey(principalId)) ??
      undefined
    );
  } catch {
    return undefined;
  }
};

/**
 * Remember a context, or forget one.
 *
 * `null` clears the key rather than writing an empty string: the private
 * context is the *absence* of a remembered team, so storing a sentinel for it
 * would make "never chose" and "chose private" two spellings of one state that
 * the read side would then have to tell apart.
 */
export const writeRememberedSlug = (
  principalId: string,
  slug: string | null,
): void => {
  try {
    const key = organizationStorageKey(principalId);

    if (slug === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, slug);
  } catch {
    /*
     * Ignored on purpose. This is a convenience about where sign-in lands, and
     * a browser that refuses to store it should still sign somebody in.
     */
  }
};

/**
 * The remembered slug, filtered through what the caller is actually a member of.
 *
 * **A remembered slug outside the memberships falls back to the private context
 * silently**, which is ADR-0067 §6's last sentence and matters more than it
 * looks: a customer removed from a team, or one whose team was deleted, would
 * otherwise sign in onto a not-found forever, because the thing sending them
 * there is on their own device and nothing on the server can clear it. The
 * personal organization is filtered out for the same reason it is not
 * addressed — it is not a slug this app ever navigates to.
 */
export const resolveRememberedSlug = (
  rows: readonly OrganizationResource[] | undefined,
  remembered: string | undefined,
): string | undefined => {
  if (remembered === undefined || rows === undefined) return undefined;

  const row = rows.find((candidate) => candidate.slug === remembered);

  return row === undefined || row.kind === "personal" ? undefined : row.slug;
};
