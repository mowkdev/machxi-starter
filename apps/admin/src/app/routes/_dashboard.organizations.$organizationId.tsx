import { Link, createFileRoute } from "@tanstack/react-router";

import {
  createOrganizationsApi,
  organizationResourceConfig,
  organizationsKeys,
} from "@/entities/organization";
import {
  EditOrganizationSurface,
  OrganizationMembersSection,
} from "@/features/organization-manage";
import { useRecordNavigation } from "@/shared/grid/record-navigation";
import { useT } from "@/shared/i18n";
import { editSurfaceOf } from "@/shared/resource/config";
import { Button, RecordError } from "@/shared/ui";

/**
 * `/organizations/$organizationId` — a record, addressable
 * (ADR-0040).
 *
 * `ensureQueryData` is called with the same key and the same function the
 * `useOrganization` hook uses (ADR-0034 §Entity API), so the surface's
 * own `useQuery` resolves from a warm cache on its first render rather than
 * fetching a second time — and a deep link in a fresh session works, because
 * the `_dashboard` guard runs first and this fetch does not care whether the
 * list was ever visited.
 *
 * The client comes from router context because an entity's API is a
 * `create...Api(client)` factory reached through a hook, and a loader is not a
 * component.
 *
 * **A rejection reaches `errorComponent`, never a blank overlay over a live
 * grid.** An id that is not a UUID and an id that is a `404` both land there.
 */
export const Route = createFileRoute(
  "/_dashboard/organizations/$organizationId",
)({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData({
      queryKey: organizationsKeys.detail(params.organizationId),
      queryFn: () =>
        createOrganizationsApi(context.client).get(params.organizationId),
    }),
  component: OrganizationRecordRoute,
  errorComponent: OrganizationRecordError,
  staticData: {
    title: "organizations:edit.routeTitle",
    fullHeight: editSurfaceOf(organizationResourceConfig) !== "page",
    /*
     * The record's own label, for the breadcrumb's last crumb and — where a
     * resource renders records as pages — the shell's heading (ADR-0048 §2).
     *
     * **The narrowing is here rather than in the reader, and it is a real check
     * rather than a cast.** The channel's parameter is `unknown` because
     * `strictFunctionTypes` checks it contravariantly, so this route — the one
     * place that knows what its own loader returns — proves the shape it relies
     * on, and anything else yields `undefined` and falls back to the route
     * title.
     */
    recordLabel: (loaderData) =>
      typeof loaderData === "object" &&
      loaderData !== null &&
      "name" in loaderData &&
      typeof loaderData.name === "string"
        ? loaderData.name
        : undefined,
  },
});

function OrganizationRecordRoute() {
  /*
   * The loader's record, handed down as a prop.
   *
   * The feature cannot read it itself: `Route.useLoaderData()` would mean
   * importing this module, and a feature may not import from `app` (ADR-0049).
   * Passing it down is the layer rule working — the route is wiring, and wiring
   * is what may see both sides.
   */
  const organization = Route.useLoaderData();

  /*
   * The record is a **page** rather than an overlay (the config says why), and
   * this is what it buys: the organization's own form and the people in it,
   * one under the other, on a route that carries only the record (ADR-0044).
   *
   * The section takes the id rather than the record: it reads and writes the
   * sub-resource under `/organizations/:id/memberships`, and nothing it needs
   * is on the organization row.
   */
  return (
    <div className="flex flex-col gap-6">
      <EditOrganizationSurface organization={organization} />
      <OrganizationMembersSection organizationId={organization.id} />
    </div>
  );
}

function OrganizationRecordError({ error }: { readonly error: Error }) {
  /*
   * Even a record that failed to load has a way back to the view it was opened
   * from, because the carrier is the navigation rather than the record
   * (ADR-0044). A cold link that 404s closes to the bare list.
   */
  const { t } = useT("organizations");
  const { closeSearch } = useRecordNavigation();

  return (
    <RecordError error={error}>
      <Button asChild variant="outline">
        <Link to="/organizations" search={closeSearch}>
          {t("backToList")}
        </Link>
      </Button>
    </RecordError>
  );
}
