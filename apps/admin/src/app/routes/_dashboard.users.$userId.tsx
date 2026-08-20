import { Link, createFileRoute } from "@tanstack/react-router";

import { createUserApi, userKeys, userResourceConfig } from "@/entities/user";
import { EditUserSurface } from "@/features/users-manage";
import { editSurfaceOf } from "@/shared/resource/config";
import { Button, RecordError } from "@/shared/ui";

/**
 * `/users/$userId` — a record, addressable (ADR-0040).
 *
 * The staff mirror; `_dashboard.staff.$staffId.tsx` carries the reasoning about
 * the loader, the context client and the error surface. The one thing worth
 * saying twice is that this file is the same length and shape as its sibling
 * even though the record opens in a drawer rather than a modal — the URL is
 * identical across all three surfaces, which is what makes `editSurface` a
 * one-line config change rather than a migration.
 */
export const Route = createFileRoute("/_dashboard/users/$userId")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData({
      queryKey: userKeys.detail(params.userId),
      queryFn: () => createUserApi(context.client).get(params.userId),
    }),
  component: UserRecordRoute,
  errorComponent: UserRecordError,
  staticData: {
    title: "Edit user",
    fullHeight: editSurfaceOf(userResourceConfig) !== "page",
  },
});

function UserRecordRoute() {
  const user = Route.useLoaderData();

  return <EditUserSurface user={user} />;
}

function UserRecordError({ error }: { readonly error: Error }) {
  return (
    <RecordError error={error}>
      <Button asChild variant="outline">
        <Link to="/users" search={true}>
          Back to users
        </Link>
      </Button>
    </RecordError>
  );
}
