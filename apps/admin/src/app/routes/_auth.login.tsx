import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { LoginPage } from "@/pages/login";

/**
 * `/login`, inside the `_auth` shell. A route file is wiring (ADR-0032): a
 * path, the page it mounts, the title the shell heads it with, and the shape of
 * its search params.
 *
 * `redirect` is where `_dashboard`'s guard puts the location it turned away, so
 * the login feature can return the operator there. Validating it is not
 * bookkeeping: an unvalidated value that later feeds a navigation is an open
 * redirect, and the fence belongs on the route that receives it rather than in
 * the code that consumes it.
 *
 * Typed search params are also the reason ADR-0032 chose this router at all
 * (§Routing), and ADR-0034 leans on the same mechanism for grid state.
 */

/**
 * A path on this origin, and nothing that can be read as another one.
 *
 * Each clause closes a bypass that was verified against
 * `new URL(value, "https://admin.example.com/login")` rather than reasoned
 * about, because a leading-slash regex looks sufficient and is not:
 *
 * - `//evil.com` — the obvious one.
 * - `/\evil.com` — the WHATWG parser treats `\` as `/` in special schemes, so
 *   this resolves to `https://evil.com`.
 * - `/<TAB>/evil.com`, and the same with LF or CR — the parser strips those
 *   characters *before* parsing, so they resolve off-origin too.
 */
const relativePath = (value: string): boolean =>
  /^\/(?![/\\])/.test(value) &&
  !value.includes("\\") &&
  // eslint-disable-next-line no-control-regex -- stripped by the URL parser, which is the bypass
  !/[\u0000-\u001f]/.test(value);

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
