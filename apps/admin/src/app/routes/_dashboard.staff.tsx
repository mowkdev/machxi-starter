import { listQuerySearchSchema } from "@repo/contracts";
import {
  Outlet,
  createFileRoute,
  retainSearchParams,
  stripSearchParams,
  useMatchRoute,
} from "@tanstack/react-router";

import { staffResourceConfig } from "@/entities/staff";
import { StaffPage } from "@/pages/staff";
import { listSearchDefaults } from "@/shared/grid/list-state";
import { editSurfaceOf } from "@/shared/resource/config";

/**
 * `/staff` — wiring, plus the list state (ADR-0034 §List state lives in
 * the URL).
 *
 * `listQuerySearchSchema` and **not** `listStaffQuery`, which was the first
 * attempt and is wrong in a way worth recording. The per-endpoint builder parses
 * the *wire* form and outputs the *parsed* one — `sort: string` in,
 * `sort: SortSpec[]` out — and TanStack Router round-trips its validated
 * output back into the URL on every navigation. So the schema would be handed
 * its own output on the first pager click and reject it
 * (`expected string, received array`), and a `.catch` would turn that into a
 * silent reset to page one. That is precisely the "state dies on navigation"
 * failure ADR-0034 §Context exists to prevent, arriving through the fix for
 * it. Verified with `listStaffQuery.safeParse(listStaffQuery.parse({}))`, which
 * fails.
 *
 * The endpoint's `sortable` and `filterable` allow-lists are still enforced —
 * by the API, when the request gets there, and by ADR-0035's config-versus-
 * contract tests before that. This schema guarantees the URL is readable back
 * as the object that wrote it; it deliberately does not restate the allow-list.
 *
 * Defaults are stripped from every built link (ADR-0034, amended D3.8): the
 * URL carries only deviations, so `/staff` *is* page one at the default size.
 * The middleware is fed the schema's own `parse({})` output
 * (`listSearchDefaults`), so the two cannot disagree about what "default"
 * means; a deep link that spells the defaults out still parses identically and
 * normalises to the bare path on the next navigation.
 *
 * **`D4.2`: this route grew children** (ADR-0040). It renders the grid *and* an
 * `<Outlet />`; `/staff/new` and `/staff/$staffId` render a record surface into
 * it. `validateSearch` stays here rather than moving down, so the list state is
 * validated once and is visible to the index and the children alike — which is
 * what makes `search: true` on a close navigation mean something.
 *
 * `retainSearchParams(true)` is the purpose-built middleware for the round trip
 * the ADR requires: open row three of page two, close it, and be on page two.
 * Hand-propagating `search` on every `Link` and `navigate` would do the same
 * thing until the first call site forgot to. Order matters and it is
 * retain-then-strip: retaining puts the current search on the navigation, and
 * stripping then removes whatever equals the defaults, so a link out of the
 * default view is still the bare path.
 */
export const Route = createFileRoute("/_dashboard/staff")({
  component: StaffRoute,
  // A grid page is a height budget, not a document (ADR-0037, `D4.1`).
  staticData: { title: "Staff", fullHeight: true },
  validateSearch: listQuerySearchSchema,
  search: {
    middlewares: [
      retainSearchParams(true),
      stripSearchParams(listSearchDefaults),
    ],
  },
});

function StaffRoute() {
  /*
   * Route topology follows the surface, in one place (ADR-0040).
   *
   * A dialog or a drawer overlays a grid that stays on screen, so the grid
   * renders regardless. A `page` surface replaces it, so the grid unmounts
   * while a record child matches — one conditional, and the child component
   * knows nothing about it.
   *
   * `useMatchRoute` rather than counting child matches: the index route is a
   * child too, so a count would say "a record is open" while looking at
   * `/staff`. Asking about the two record paths by name is also typed — a
   * renamed route is a compile error here rather than a grid that stopped
   * disappearing.
   */
  const matchRoute = useMatchRoute();
  const onRecord = Boolean(
    matchRoute({ to: "/staff/new" }) ?? matchRoute({ to: "/staff/$staffId" }),
  );
  const replacesTheGrid = editSurfaceOf(staffResourceConfig) === "page";

  return (
    <>
      {replacesTheGrid && onRecord ? null : <StaffPage />}
      <Outlet />
    </>
  );
}
