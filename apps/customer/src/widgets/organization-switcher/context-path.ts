/**
 * Where a screen lives in another context (`D15.9`, ADR-0067 §6 as amended
 * 2026-09-07).
 *
 * **The switcher switches; it does not navigate to a screen.** Choosing a
 * context keeps the screen the caller is on and swaps the prefix — a customer
 * comparing two teams' member lists stays on the member list — and a screen
 * with no counterpart in the chosen context lands on that context's home.
 *
 * That rule is a pure function of the current pathname, which is why it is a
 * module rather than a branch inside the menu's `onSelect`: it is the one piece
 * of this widget with more than one answer, and the suite drives it through the
 * router rather than by calling it, so what is asserted is the navigation
 * rather than the string.
 */

/**
 * The screens a team context has, keyed by the name the private context would
 * know them by.
 *
 * A literal map rather than string surgery on the pathname, and the typing is
 * the reason: these are route ids checked against the generated tree, so a
 * renamed route is a compile error here rather than a menu entry that 404s
 * (ADR-0049 §Routing). Building `/orgs/${slug}/settings/${section}` by hand
 * would put this widget outside the router's own guarantees.
 */
export const TEAM_ROUTES = {
  home: "/orgs/$orgSlug",
  general: "/orgs/$orgSlug/settings/general",
  members: "/orgs/$orgSlug/settings/members",
  invitations: "/orgs/$orgSlug/settings/invitations",
} as const;

export type TenantScreen = keyof typeof TEAM_ROUTES;

/**
 * Which screen a pathname is, from the switcher's point of view.
 *
 * Everything that is not a team's settings section is `home`, and that includes
 * three genuinely different cases collapsed on purpose:
 *
 * - `/` and `/orgs/<slug>`, which *are* the home screen in their two contexts;
 * - a **self-scoped** screen (`/account/*`), which belongs to the person rather
 *   than to any tenant — switching context from one's own profile should land
 *   in that context rather than pretend a profile has a per-tenant twin;
 * - anything this app grows later and this function has not been taught, which
 *   lands somewhere real rather than throwing inside a menu.
 *
 * The private context has no settings surface at all (ADR-0067 §6: a personal
 * organization's name is unmanaged and its address derived), so it is not in
 * the map and choosing it always resolves to `/`.
 */
export const screenOf = (pathname: string): TenantScreen => {
  const match = /^\/orgs\/[^/]+\/settings\/([^/]+)/.exec(pathname);
  const section = match?.[1];

  if (
    section === "general" ||
    section === "members" ||
    section === "invitations"
  )
    return section;

  return "home";
};
