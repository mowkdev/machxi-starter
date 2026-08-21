import { listQuerySearchSchema } from "@repo/contracts";
import {
  Outlet,
  createFileRoute,
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
 * validated once and is visible to the index and the children alike.
 *
 * **`D5.3`: the list state is no longer retained onto the children**
 * (ADR-0044). `retainSearchParams` is gone, so `/staff/new` and
 * `/staff/$staffId` carry the record and nothing else — "look at this account"
 * is a link to an account rather than to somebody's page 2. What replaces it is
 * `shared/grid/record-navigation`: the opening navigation carries the list
 * state as **history state**, and the closing one puts it back on the URL.
 *
 * The consequence to know before touching this file: the grid rendered below
 * reads *this route's* search, and while a record is open that search is the
 * record URL's — which now has no list params. `StaffPage` therefore reads the
 * carried snapshot, not `useSearch` alone, or the drawer would float over page
 * one of an unfiltered grid.
 */
export const Route = createFileRoute("/_dashboard/staff")({
  component: StaffRoute,
  // A grid page is a height budget, not a document (ADR-0037, `D4.1`).
  staticData: { title: "Staff", fullHeight: true },
  validateSearch: listQuerySearchSchema,
  search: {
    middlewares: [stripSearchParams(listSearchDefaults)],
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
  /*
   * Two things this call has to say explicitly, both found in the browser at
   * `D4.2` because the surface they break is one no resource uses yet:
   *
   * - **`includeSearch: false`.** `matchRoute` compares search params as well
   *   as the path by default, so asking about `/staff/new` while the URL is
   *   `/staff/new?limit=50` answers *no* — and the grid stayed mounted under a
   *   `page` surface that had already replaced it. The question here is about
   *   the path, and it stays that way after `D5.3`: a record URL carries no
   *   list params now, but this route's *own* URL still does, so comparing
   *   search would still answer the wrong question.
   * - **`||`, not `??`.** A miss is `false`, not `undefined`, so `??` would
   *   return the first miss and never ask about the second path — leaving
   *   `/staff/$staffId` permanently unrecognised.
   */
  const onRecord = Boolean(
    matchRoute({ to: "/staff/new", includeSearch: false }) ||
    matchRoute({ to: "/staff/$staffId", includeSearch: false }),
  );
  const replacesTheGrid = editSurfaceOf(staffResourceConfig) === "page";

  return (
    <>
      {replacesTheGrid && onRecord ? null : <StaffPage />}
      <Outlet />
    </>
  );
}
