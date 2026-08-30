import { listQuerySearchSchema } from "@repo/contracts";
import {
  Outlet,
  createFileRoute,
  stripSearchParams,
  useMatchRoute,
} from "@tanstack/react-router";

import { userResourceConfig } from "@/entities/user";
import { UsersPage } from "@/pages/users";
import { listSearchDefaults } from "@/shared/grid/list-state";
import { editSurfaceOf } from "@/shared/resource/config";

/**
 * `/users` — wiring, plus the list state (ADR-0034 §List state lives in
 * the URL).
 *
 * `listQuerySearchSchema` and **not** `listUsersQuery`, which was the first
 * attempt and is wrong in a way worth recording. The per-endpoint builder parses
 * the *wire* form and outputs the *parsed* one — `sort: string` in,
 * `sort: SortSpec[]` out — and TanStack Router round-trips its validated
 * output back into the URL on every navigation. So the schema would be handed
 * its own output on the first pager click and reject it
 * (`expected string, received array`), and a `.catch` would turn that into a
 * silent reset to page one. That is precisely the "state dies on navigation"
 * failure ADR-0034 §Context exists to prevent, arriving through the fix for
 * it. Verified with `listUsersQuery.safeParse(listUsersQuery.parse({}))`, which
 * fails.
 *
 * The endpoint's `sortable` and `filterable` allow-lists are still enforced —
 * by the API, when the request gets there, and by ADR-0035's config-versus-
 * contract tests before that. This schema guarantees the URL is readable back
 * as the object that wrote it; it deliberately does not restate the allow-list.
 *
 * Defaults are stripped from every built link (ADR-0034, amended D3.8): the
 * URL carries only deviations, so `/users` *is* page one at the default size.
 * The middleware is fed the schema's own `parse({})` output
 * (`listSearchDefaults`), so the two cannot disagree about what "default"
 * means; a deep link that spells the defaults out still parses identically and
 * normalises to the bare path on the next navigation.
 *
 * **`D4.2`: this route grew children** (ADR-0040) — `/users/new` and
 * `/users/$userId` render into its `<Outlet />`. **`D5.3`: they carry the
 * record and nothing else** (ADR-0044); the list's page and filters travel
 * across opening and closing as history state instead, through
 * `shared/grid/record-navigation`. The staff parent carries the full
 * reasoning, including the trap — the grid below reads this route's search,
 * which on a record URL no longer describes the list.
 */
export const Route = createFileRoute("/_dashboard/users")({
  component: UsersRoute,
  staticData: {
    title: "users:title",
    // The page-header band's second line (ADR-0054 §5, `D11.3`).
    description: "users:description",
    // A height budget, and with it the full-bleed container (`D11.3`).
    fullHeight: true,
  },
  validateSearch: listQuerySearchSchema,
  search: {
    middlewares: [stripSearchParams(listSearchDefaults)],
  },
});

function UsersRoute() {
  /*
   * The staff parent's shape, with the same reasoning — see
   * `_dashboard.staff.tsx`. `userResourceConfig` declares a drawer, so today
   * this never unmounts the grid; the conditional stays because the surface is
   * a config line and the topology has to follow it (ADR-0040).
   */
  const matchRoute = useMatchRoute();
  // `includeSearch: false` and `||` rather than `??` — see the staff parent,
  // which records what each of them costs when it is wrong.
  const onRecord = Boolean(
    matchRoute({ to: "/users/new", includeSearch: false }) ||
    matchRoute({ to: "/users/$userId", includeSearch: false }),
  );

  return (
    <>
      {editSurfaceOf(userResourceConfig) === "page" && onRecord ? null : (
        <UsersPage />
      )}
      <Outlet />
    </>
  );
}
