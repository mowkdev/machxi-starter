import type { OrganizationRole } from "@repo/contracts";
import { createLogger } from "@repo/logger";
import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";

import {
  createRequestContext,
  type Principal,
  type RequestContext,
} from "../../../core/context/index.js";
import { isAppError } from "../../../core/errors/index.js";
import type {
  MembershipsRepository,
  ResolvedMembership,
} from "../memberships.repository.js";
import {
  createRequireMembership,
  ORGANIZATION_PARAM,
} from "../organizations.middleware.js";

/**
 * `requireMembership` — the third guard (ADR-0067 §4, a delta on ADR-0019).
 *
 * Driven directly rather than through supertest: the guard is a
 * `RequestHandler` over one repository read, so a fake request with a `ctx` on
 * it exercises every branch it has, and `apps/api/test` proves the mounts.
 * What is checked here is the shape of its two refusals — which are
 * deliberately *different* statuses — and the one fact it writes.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const ORG_ID = "33333333-3333-4333-8333-333333333333";

const userPrincipal = (id = USER_ID): Principal => ({
  kind: "user",
  id,
  roles: ["customer"],
  sessionId: "44444444-4444-4444-8444-444444444444",
});

const staffPrincipal = (): Principal => ({
  kind: "staff",
  id: "55555555-5555-4555-8555-555555555555",
  roles: ["admin"],
  sessionId: "66666666-6666-4666-8666-666666666666",
});

/**
 * The repository narrowed to the one function the guard calls, holding the
 * memberships as `organizationId:userId` — and answering `undefined` for a
 * pair it does not hold, which is how "not a member" and "no such live
 * organization" arrive at the guard as the same thing.
 */
const createFakeMemberships = (
  seed: readonly (ResolvedMembership & { userId: string })[],
) => {
  const calls: { organizationId: string; userId: string }[] = [];

  const repository = {
    resolveFor: (organizationId: string, userId: string) => {
      calls.push({ organizationId, userId });

      const row = seed.find(
        (m) => m.organizationId === organizationId && m.userId === userId,
      );

      return Promise.resolve(
        row === undefined
          ? undefined
          : {
              organizationId: row.organizationId,
              slug: row.slug,
              role: row.role,
            },
      );
    },
  };

  return {
    calls,
    repository: repository as unknown as MembershipsRepository,
  } as const;
};

const membership = (
  role: OrganizationRole,
  userId = USER_ID,
): ResolvedMembership & { userId: string } => ({
  organizationId: ORG_ID,
  slug: "acme",
  role,
  userId,
});

const requestFor = (
  principal: Principal | null,
  orgId: string,
): { req: Request; ctx: RequestContext } => {
  const ctx = createRequestContext({
    requestId: "req-1",
    logger: createLogger({ level: "silent", name: "test" }),
  });

  ctx.principal = principal;

  const req = {
    ctx,
    params: { [ORGANIZATION_PARAM]: orgId },
  } as unknown as Request;

  return { req, ctx };
};

/**
 * Runs the guard and reports which way it went: `next` called, or an
 * `AppError` thrown.
 */
const run = async (
  guard: ReturnType<ReturnType<typeof createRequireMembership>>,
  principal: Principal | null,
  orgId = ORG_ID,
) => {
  const { req, ctx } = requestFor(principal, orgId);
  let passed = false;

  const error: unknown = await Promise.resolve(
    guard(req, {} as Response, () => {
      passed = true;
    }),
  ).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  return { passed, error, ctx } as const;
};

const expectAppError = (error: unknown, status: number, code: string) => {
  if (!isAppError(error)) {
    throw new Error(`expected an AppError, got ${String(error)}`);
  }

  expect(error.status).toBe(status);
  expect(error.code).toBe(code);
};

describe("requireMembership", () => {
  it("answers 404 for a non-member, so organization existence is not disclosed", async () => {
    const memberships = createFakeMemberships([membership("owner", OTHER_ID)]);
    const guard = createRequireMembership({
      memberships: memberships.repository,
    })();

    const { passed, error } = await run(guard, userPrincipal());

    expect(passed).toBe(false);
    // Deliberately not 403: ADR-0019 refuses to reveal route existence to a
    // caller not entitled to know it, and an organization is no different.
    expectAppError(error, 404, "NOT_FOUND");
  });

  it("answers 403 for a member whose role is below the one required", async () => {
    const memberships = createFakeMemberships([membership("member")]);
    const guard = createRequireMembership({
      memberships: memberships.repository,
    })("owner");

    const { passed, error, ctx } = await run(guard, userPrincipal());

    expect(passed).toBe(false);
    // The caller *is* inside the organization and may know it exists, so the
    // status is the one a client can render "you are not an owner here" from.
    expectAppError(error, 403, "FORBIDDEN");
    // And nothing is placed on the context by a refused request.
    expect(ctx.organization).toBeNull();
  });

  it("places the resolved membership on the context and calls next", async () => {
    const memberships = createFakeMemberships([membership("admin")]);
    const guard = createRequireMembership({
      memberships: memberships.repository,
    })();

    const { passed, ctx } = await run(guard, userPrincipal());

    expect(passed).toBe(true);
    expect(ctx.organization).toEqual({
      id: ORG_ID,
      // The slug rides along so a slug-addressed screen is not looked up twice
      // (ADR-0067 §4).
      slug: "acme",
      role: "admin",
    });
  });

  it("admits a member holding any of the listed roles", async () => {
    const memberships = createFakeMemberships([membership("admin")]);
    const guard = createRequireMembership({
      memberships: memberships.repository,
    })("owner", "admin");

    const { passed, ctx } = await run(guard, userPrincipal());

    expect(passed).toBe(true);
    expect(ctx.organization?.role).toBe("admin");
  });

  it("has no role hierarchy: an owner does not satisfy a guard listing admin alone", async () => {
    const memberships = createFakeMemberships([membership("owner")]);
    const guard = createRequireMembership({
      memberships: memberships.repository,
    })("admin");

    const { passed, error } = await run(guard, userPrincipal());

    expect(passed).toBe(false);
    expectAppError(error, 403, "FORBIDDEN");
  });

  it("answers 404 for a malformed organization id without reading the database", async () => {
    const memberships = createFakeMemberships([membership("owner")]);
    const guard = createRequireMembership({
      memberships: memberships.repository,
    })();

    const { passed, error } = await run(guard, userPrincipal(), "not-a-uuid");

    expect(passed).toBe(false);
    // The same non-answer a stranger's organization gets — and it keeps a
    // non-uuid out of a `where id = $1` that would escape as a 500.
    expectAppError(error, 404, "NOT_FOUND");
    expect(memberships.calls).toEqual([]);
  });

  it("answers 401 for a staff principal, which is a wiring mistake and never a client's doing", async () => {
    const memberships = createFakeMemberships([membership("owner")]);
    const guard = createRequireMembership({
      memberships: memberships.repository,
    })();

    const { passed, error } = await run(guard, staffPrincipal());

    expect(passed).toBe(false);
    // Staff are never members (ADR-0067 §3); the guard only mounts on the user
    // segment, so this can only come from a router mounted wrongly and it is
    // answered the way ADR-0019 answers every other one.
    expectAppError(error, 401, "UNAUTHENTICATED");
    expect(memberships.calls).toEqual([]);
  });

  it("answers 401 with no principal at all", async () => {
    const memberships = createFakeMemberships([membership("owner")]);
    const guard = createRequireMembership({
      memberships: memberships.repository,
    })();

    const { passed, error } = await run(guard, null);

    expect(passed).toBe(false);
    expectAppError(error, 401, "UNAUTHENTICATED");
  });

  it("looks the membership up by the caller's own id, never by anything in the request", async () => {
    const memberships = createFakeMemberships([membership("owner")]);
    const guard = createRequireMembership({
      memberships: memberships.repository,
    })();

    await run(guard, userPrincipal());

    expect(memberships.calls).toEqual([
      { organizationId: ORG_ID, userId: USER_ID },
    ]);
  });
});
