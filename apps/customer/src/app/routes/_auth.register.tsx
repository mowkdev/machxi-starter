import { createFileRoute, notFound } from "@tanstack/react-router";

import { RegisterPage } from "@/pages/register";

/**
 * `/register`, inside the `_auth` shell (`D15.6`, ADR-0067 §6 — the deferral
 * ADR-0055 §5 left open). A route file is wiring (ADR-0049): a path, the page
 * it mounts, the copy the shell heads it with, and the one guard the address
 * carries.
 *
 * **The flag makes the address not exist, and `notFound()` is how a router
 * says that.** Thrown from `beforeLoad` it is caught by the boundary above and
 * renders `defaultNotFoundComponent` — the same "That address does not exist."
 * an unknown path gets — which is the client's echo of the API's own choice:
 * with `FEATURE_USER_REGISTRATION` off the endpoint answers `404
 * ROUTE_NOT_FOUND` rather than a `403` that would confirm the feature is there
 * and merely switched off (ADR-0004). A redirect to `/login` would have been
 * the other option and is the wrong one: it would tell whoever typed the
 * address that something is behind it.
 *
 * The flag is read from the router context rather than from `shared/config`,
 * because a `beforeLoad` is not a component and cannot reach a provider — see
 * `app/providers/router.tsx`, which also explains why it is a parameter.
 *
 * **The API is the control, not this.** With the client flag on and the API's
 * off, the address renders and the form's submit meets `ROUTE_NOT_FOUND`,
 * which the `errors` catalogue turns into a written sentence.
 */
export const Route = createFileRoute("/_auth/register")({
  beforeLoad: ({ context }) => {
    if (!context.features.userRegistration) throw notFound();
  },
  component: RegisterPage,
  staticData: {
    description: "auth:register.subtitle",
    title: "auth:register.title",
  },
});
