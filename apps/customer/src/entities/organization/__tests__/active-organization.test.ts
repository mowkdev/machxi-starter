import type { OrganizationResource } from "@repo/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  organizationStorageKey,
  readRememberedSlug,
  resolveActiveOrganization,
  resolveRememberedSlug,
  writeRememberedSlug,
} from "@/entities/organization";

import {
  PERSONAL_ORGANIZATION,
  TEAM_ORGANIZATION,
} from "@/test/msw/handlers/organizations.handlers";

/**
 * The active-organization resolver (`D15.9`, ADR-0067 §6 as amended
 * 2026-09-07).
 *
 * **A `.ts` suite with no router and no DOM**, which is the whole reason the
 * decisions live in a pure module and the hook is two lines on top of it: what
 * is under test here is the *rule* — which organization a caller is acting as —
 * and a rendering test would prove it only for the screen it happened to mount.
 * The hook's binding to the router is asserted where it matters, by the switcher
 * and the screens navigating for real.
 *
 * The fixtures are the MSW handlers' own rows rather than literals invented
 * here, so a resolver asserted against a shape the mock does not serve is not a
 * thing this suite can accidentally certify.
 */

const ROWS: readonly OrganizationResource[] = [
  PERSONAL_ORGANIZATION,
  TEAM_ORGANIZATION,
];

afterEach(() => {
  localStorage.clear();
});

describe("resolveActiveOrganization", () => {
  it("answers the personal organization when the path carries no slug", () => {
    const active = resolveActiveOrganization(ROWS, undefined);

    /*
     * The private context is a *real* organization with a real id, which is the
     * property ADR-0067 §6 leans on: a request made from an unprefixed screen
     * carries this id in `/user/orgs/:orgId/...` exactly as a team's screen
     * carries the team's, so the API is untouched by the two addresses.
     */
    expect(active.state).toBe("resolved");
    expect(active.organization).toBe(PERSONAL_ORGANIZATION);
    expect(active.slug).toBeUndefined();
  });

  it("answers the addressed team when the path carries its slug", () => {
    const active = resolveActiveOrganization(ROWS, TEAM_ORGANIZATION.slug);

    expect(active.state).toBe("resolved");
    expect(active.organization).toBe(TEAM_ORGANIZATION);
  });

  it("answers missing for a slug outside the memberships", () => {
    const active = resolveActiveOrganization(ROWS, "not-mine");

    expect(active.state).toBe("missing");
    expect(active.organization).toBeUndefined();
  });

  it("answers missing for the personal organization's own slug", () => {
    /*
     * Only a team is addressed (ADR-0067 §6's third bullet). This is the case
     * `D15.5` got wrong — it put `/orgs/personal-<uuid>/…` in the address bar of
     * the context a private person spends most of their time in — so it is
     * asserted as its own case rather than folded into "unknown slug", which it
     * is not: the row is right there in the list.
     */
    const active = resolveActiveOrganization(ROWS, PERSONAL_ORGANIZATION.slug);

    expect(active.state).toBe("missing");
  });

  it("stays pending while the list has not arrived", () => {
    /*
     * The distinction that keeps a cold load from flashing a dead end: a list
     * that has not arrived and a list holding no such slug are different things,
     * and only the second is a not-found.
     */
    const active = resolveActiveOrganization(undefined, TEAM_ORGANIZATION.slug);

    expect(active.state).toBe("pending");
    expect(active.organization).toBeUndefined();
  });
});

describe("the remembered context", () => {
  it("is stored under a key that is the principal's", () => {
    /*
     * The privacy property of ADR-0067 §6, asserted rather than described: two
     * accounts sharing a browser do not inherit each other's last tenant, and an
     * impersonated session reads the customer's key because the key is built
     * from the principal — who, under impersonation, *is* the customer.
     */
    const mine = organizationStorageKey("me");
    const theirs = organizationStorageKey("you");

    expect(mine).not.toBe(theirs);
    expect(mine).toContain("me");

    writeRememberedSlug("me", TEAM_ORGANIZATION.slug);

    expect(readRememberedSlug("me")).toBe(TEAM_ORGANIZATION.slug);
    expect(readRememberedSlug("you")).toBeUndefined();
    // The value is on the device under exactly that key and nowhere else.
    expect(localStorage.getItem(mine)).toBe(TEAM_ORGANIZATION.slug);
  });

  it("forgets rather than storing a sentinel for the private context", () => {
    writeRememberedSlug("me", TEAM_ORGANIZATION.slug);
    writeRememberedSlug("me", null);

    /*
     * "Never chose" and "chose private" have to stay one state, or the read
     * side would have to tell two spellings of the same thing apart.
     */
    expect(localStorage.getItem(organizationStorageKey("me"))).toBeNull();
    expect(readRememberedSlug("me")).toBeUndefined();
  });

  it("resolves a remembered team the caller is still in", () => {
    expect(resolveRememberedSlug(ROWS, TEAM_ORGANIZATION.slug)).toBe(
      TEAM_ORGANIZATION.slug,
    );
  });

  it("falls back to the private context when the remembered slug is not a membership", () => {
    /*
     * The case that matters most and is invisible from the happy path: the value
     * is on the customer's own device, so a team they have been removed from
     * would send them to a not-found on every sign-in forever, with nothing a
     * server response could do about it.
     */
    expect(resolveRememberedSlug(ROWS, "left-this-one")).toBeUndefined();
  });

  it("never resolves the personal organization's slug", () => {
    // It is not a slug this app navigates to, so remembering one is the same
    // as remembering nothing.
    expect(
      resolveRememberedSlug(ROWS, PERSONAL_ORGANIZATION.slug),
    ).toBeUndefined();
  });
});
