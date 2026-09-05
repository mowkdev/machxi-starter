import { createFileRoute } from "@tanstack/react-router";

import { organizationResourceConfig } from "@/entities/organization";
import { CreateOrganizationSurface } from "@/features/organization-manage";
import { editSurfaceOf } from "@/shared/resource/config";

/**
 * `/organizations/new` — composing a record (ADR-0040).
 *
 * Wiring, as a route file must be (ADR-0049): the form, its validation and its
 * mutation all belong to the feature. There is no loader, because there is no
 * record to load — a create form starts from the config's `initialValue`s.
 *
 * `fullHeight` is read from the config rather than fixed, and the reason is
 * ADR-0037's: a `page` surface has unmounted the grid, so what is on screen is
 * a form, and a form taller than the viewport should scroll as a document. A
 * dialog or a drawer leaves the grid underneath, still wanting its height
 * budget, so the parent's `true` stands.
 */
export const Route = createFileRoute("/_dashboard/organizations/new")({
  component: CreateOrganizationSurface,
  staticData: {
    title: "organizations:create.routeTitle",
    fullHeight: editSurfaceOf(organizationResourceConfig) !== "page",
  },
});
