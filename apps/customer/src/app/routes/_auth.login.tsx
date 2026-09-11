import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { LoginPage } from "@/pages/login";
import { relativePath } from "@/shared/lib/relative-path";

/**
 * `/login`, inside the `_auth` shell. A route file is wiring (ADR-0049): a
 * path, the page it mounts, the copy the shell heads it with, and the shape of
 * its search params.
 *
 * `redirect` is where `_dashboard`'s guard will put the location it turned away
 * (`D12.2`), so the login feature can return the customer there. Validating it
 * is not bookkeeping: an unvalidated value that later feeds a navigation is an
 * open redirect, and the fence belongs on the route that receives it rather
 * than in the code that consumes it — so it lands with the route rather than
 * with its first reader. The fence itself is `shared/lib`'s since `D19.5`,
 * because the Google landing route applies it to the same value a second
 * time, after the round trip (ADR-0072 §4).
 */

const searchSchema = z.object({
  redirect: z
    .string()
    .max(2048)
    .refine(relativePath, "must be a path on this origin")
    .optional()
    /*
     * A hostile `?redirect=https://evil.com` would otherwise throw out of
     * `validateSearch` and replace the login screen with a router error — a
     * small denial of the one page an unauthenticated visitor needs. Dropping
     * the value is the safe reading of one we have already refused to honour.
     */
    .catch(undefined),
});

export const Route = createFileRoute("/_auth/login")({
  component: LoginPage,
  staticData: { description: "auth:subtitle", title: "auth:title" },
  validateSearch: searchSchema,
});
