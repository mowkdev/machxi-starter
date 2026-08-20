import { createFileRoute } from "@tanstack/react-router";

/**
 * `/users` — the empty leaf (ADR-0040).
 *
 * The grid is rendered by the *parent*, not here, and that is the load-bearing
 * choice: if the list lived on this route, opening a record would unmount the
 * grid and rebuild it on close — losing the scroll position and re-running the
 * query — which is precisely what a dialog or a drawer overlaying a live grid
 * must not do. So the parent owns the grid, and this exists to be the child
 * that matches when no record is open.
 */
export const Route = createFileRoute("/_dashboard/users/")({
  component: () => null,
});
