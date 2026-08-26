import { Link, createFileRoute } from "@tanstack/react-router";

import { createUserApi, userKeys, userResourceConfig } from "@/entities/user";
import { EditUserSurface } from "@/features/users-manage";
import { useT } from "@/shared/i18n";
import { useRecordNavigation } from "@/shared/grid/record-navigation";
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
    title: "users:edit.routeTitle",
    fullHeight: editSurfaceOf(userResourceConfig) !== "page",
    // The staff route's twin, and narrowed here for the same reason (`D8.6`,
    // ADR-0048 §2): the channel's parameter is `unknown` because
    // `strictFunctionTypes` checks it contravariantly, so the route that owns
    // its loader's type is the one place the check can be justified.
    recordLabel: (loaderData) =>
      typeof loaderData === "object" &&
      loaderData !== null &&
      "email" in loaderData &&
      typeof loaderData.email === "string"
        ? loaderData.email
        : undefined,
  },
});

function UserRecordRoute() {
  const user = Route.useLoaderData();

  return <EditUserSurface user={user} />;
}

function UserRecordError({ error }: { readonly error: Error }) {
  // The way back survives a failed load too (ADR-0044, `D5.3`).
  const { t } = useT("users");
  const { closeSearch } = useRecordNavigation();

  return (
    <RecordError error={error}>
      <Button asChild variant="outline">
        <Link to="/users" search={closeSearch}>
          {t("backToList")}
        </Link>
      </Button>
    </RecordError>
  );
}
