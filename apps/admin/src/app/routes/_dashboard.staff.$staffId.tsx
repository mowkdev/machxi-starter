import { Link, createFileRoute } from "@tanstack/react-router";

import {
  createStaffApi,
  staffKeys,
  staffResourceConfig,
} from "@/entities/staff";
import { EditStaffSurface } from "@/features/staff-manage";
import { useRecordNavigation } from "@/shared/grid/record-navigation";
import { editSurfaceOf } from "@/shared/resource/config";
import { Button, RecordError } from "@/shared/ui";

/**
 * `/staff/$staffId` — a record, addressable (ADR-0040).
 *
 * **The first real user of the loader plumbing D3 threaded and left idle.**
 * `ensureQueryData` is called with the same key and the same function the
 * `useStaff` hook uses (ADR-0034 §Entity API), so the surface's own `useQuery`
 * resolves from a warm cache on its first render rather than fetching a second
 * time — and a deep link in a fresh session works, because the `_dashboard`
 * guard runs first and this fetch does not care whether the list was ever
 * visited.
 *
 * The client comes from router context for the reason `__root.tsx` records: an
 * entity's API is a `createStaffApi(client)` factory reached through a hook,
 * and a loader is not a component.
 *
 * **A rejection reaches `errorComponent`, never a blank overlay over a live
 * grid.** An id that is not a UUID and an id that is a `404` both land there —
 * the routed sibling of the D3.7 rule that a surface which reads must render
 * its own failure (ADR-0034).
 */
export const Route = createFileRoute("/_dashboard/staff/$staffId")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData({
      queryKey: staffKeys.detail(params.staffId),
      queryFn: () => createStaffApi(context.client).get(params.staffId),
    }),
  component: StaffRecordRoute,
  errorComponent: StaffRecordError,
  staticData: {
    title: "Edit staff member",
    fullHeight: editSurfaceOf(staffResourceConfig) !== "page",
  },
});

function StaffRecordRoute() {
  /*
   * The loader's record, handed down as a prop.
   *
   * The feature cannot read it itself: `Route.useLoaderData()` would mean
   * importing this module, and a feature may not import from `app` (ADR-0032).
   * Passing it down is the layer rule working — the route is wiring, and wiring
   * is what may see both sides.
   */
  const staff = Route.useLoaderData();

  return <EditStaffSurface staff={staff} />;
}

function StaffRecordError({ error }: { readonly error: Error }) {
  /*
   * Even a record that failed to load has a way back to the view it was opened
   * from, because the carrier is the navigation rather than the record
   * (ADR-0044). A cold link that 404s closes to the bare list.
   */
  const { closeSearch } = useRecordNavigation();

  return (
    <RecordError error={error}>
      <Button asChild variant="outline">
        <Link to="/staff" search={closeSearch}>
          Back to staff
        </Link>
      </Button>
    </RecordError>
  );
}
