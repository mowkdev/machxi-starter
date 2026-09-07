import { createFileRoute } from "@tanstack/react-router";

import { HomePage } from "@/pages/home";

/**
 * `/orgs/$orgSlug` — the home screen, acting as a team (`D15.9`, ADR-0067 §6 as
 * amended 2026-09-07).
 *
 * **The same page `/` mounts**, which is the amendment's first bullet: a tenant
 * screen exists at `/<screen>` acting as the personal organization and at
 * `/orgs/$orgSlug/<screen>` acting as a team, and the page takes the resolved
 * organization rather than the address. So this file is two lines and the
 * summary card `D15.5` put here is retired — it was a screen whose one action
 * was its own settings, which is what made "switching" read as "opening
 * settings".
 *
 * Under `_dashboard`, so the guard is inherited rather than remembered
 * (ADR-0049 §Layout topology).
 *
 * **The slug, not the id**, mirroring the API so a customer's URL and an API
 * path say the same thing — and a slug is what a person can read back off the
 * address bar. The translation into the id the API wants happens once, in
 * `useActiveOrganization`, against the switcher's list.
 *
 * There is deliberately **no loader**: resolving the slug is a cache read, not a
 * fetch, and a loader would turn "you are not in that organization" into a round
 * trip whose timing says whether the organization exists.
 *
 * The `/orgs/` literal stays for the reason ADR-0067 §6 gives: without it every
 * top-level route name would have to be reserved in the slug namespace forever.
 */
export const Route = createFileRoute("/_dashboard/orgs/$orgSlug/")({
  component: HomePage,
  staticData: { title: "home:title" },
});
