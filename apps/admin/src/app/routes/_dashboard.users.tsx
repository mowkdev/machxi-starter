import { listQuerySearchSchema } from "@repo/contracts";
import { createFileRoute, stripSearchParams } from "@tanstack/react-router";

import { UsersPage } from "@/pages/users";
import { listSearchDefaults } from "@/shared/grid/list-state";

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
 */
export const Route = createFileRoute("/_dashboard/users")({
  component: UsersPage,
  staticData: { title: "Users" },
  validateSearch: listQuerySearchSchema,
  search: { middlewares: [stripSearchParams(listSearchDefaults)] },
});
