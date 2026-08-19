import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { LoginPage } from "@/pages/login";

/**
 * `/login`, inside the `_auth` shell. A route file is wiring (ADR-0032): a
 * path, the page it mounts, the title the shell heads it with, and the shape of
 * its search params.
 *
 * `redirect` is where `_dashboard`'s guard puts the location it turned away, so
 * `D3.4` can return the operator there after signing in. Validating it is not
 * bookkeeping: an unvalidated value that later feeds a navigation is an open
 * redirect, and the fence belongs on the route that receives it rather than in
 * the code that will consume it. A relative path only — anything with a scheme
 * or a `//` prefix names another origin.
 *
 * Typed search params are also the reason ADR-0032 chose this router at all
 * (§Routing), and ADR-0034 leans on the same mechanism for grid state.
 */
const searchSchema = z.object({
  redirect: z
    .string()
    .regex(/^\/(?!\/)/, "must be a path on this origin")
    .optional(),
});

export const Route = createFileRoute("/_auth/login")({
  component: LoginPage,
  staticData: { title: "Sign in" },
  validateSearch: searchSchema,
});
