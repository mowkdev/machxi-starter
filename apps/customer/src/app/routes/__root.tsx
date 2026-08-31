import { Outlet, createRootRoute } from "@tanstack/react-router";

/**
 * The root route (ADR-0049 §Layout topology).
 *
 * **It declares no router context yet**, and the shape is the step boundary:
 * the admin's root uses `createRootRouteWithContext<RouterContext>()` to type
 * `context.session`, `context.queryClient` and `context.client` inside a
 * `beforeLoad`, and this app has none of the three until `D12.2` builds the
 * session machine over `createApiClient({ segment: "user" })`. Declaring an
 * empty context now would type-check and mean nothing; the one line changes
 * when there is something true to put in it.
 *
 * The `<Toaster>` the admin mounts here belongs with the same step, for the
 * same reason — ADR-0034's global handlers are what render into it, and they
 * arrive with the query client.
 */
export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return <Outlet />;
}
