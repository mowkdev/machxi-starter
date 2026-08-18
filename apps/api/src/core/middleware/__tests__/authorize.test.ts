import type { StaffRole, UserRole } from "@repo/contracts";
import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import type { Principal, RequestContext } from "../../context/index.js";
import { isAppError } from "../../errors/index.js";
import { authorize } from "../authorize.js";

/**
 * ADR-0019 §2: role checks, the `super_admin` bypass, and deny-by-default.
 *
 * The guard reads nothing but `req.ctx.principal`, so the harness is a context
 * object rather than an app — what is under test is the decision, not Express.
 */

const staff = (...roles: StaffRole[]): Principal => ({
  kind: "staff",
  id: "11111111-1111-7111-8111-111111111111",
  roles,
  sessionId: "22222222-2222-7222-8222-222222222222",
});

const user = (...roles: UserRole[]): Principal => ({
  kind: "user",
  id: "33333333-3333-7333-8333-333333333333",
  roles,
  sessionId: "44444444-4444-7444-8444-444444444444",
});

/** Runs the guard and reports whether it called `next()`. */
const run = (
  guard: ReturnType<typeof authorize>,
  principal: Principal | null,
): { passed: boolean; error: unknown } => {
  // `NextFunction` is overloaded (`next()` and `next("router")`), which a
  // single mock signature cannot satisfy; the guard only ever calls it with no
  // arguments, and what is asserted is that it was called at all.
  const next = vi.fn();
  const req = { ctx: { principal } as RequestContext } as Request;

  try {
    guard(req, {} as Response, next as unknown as NextFunction);

    return { passed: next.mock.calls.length === 1, error: undefined };
  } catch (error) {
    return { passed: false, error };
  }
};

describe("authorize", () => {
  it("admits a principal holding one of the allowed roles", () => {
    expect(run(authorize("admin", "manager"), staff("manager")).passed).toBe(
      true,
    );
  });

  it("refuses a principal holding none of them", () => {
    const { passed, error } = run(authorize("admin"), staff("editor"));

    expect(passed).toBe(false);
    expect(isAppError(error)).toBe(true);
    expect(error).toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("lets super_admin through every staff check", () => {
    // The bypass is explicit and on one line in the guard so it stays
    // greppable from the seed and the last-super-admin invariant (ADR-0017).
    expect(run(authorize("admin"), staff("super_admin")).passed).toBe(true);
    expect(run(authorize("manager"), staff("super_admin")).passed).toBe(true);
  });

  it("denies by default: an empty role list admits only super_admin", () => {
    expect(run(authorize(), staff("admin")).passed).toBe(false);
    expect(run(authorize(), staff("super_admin")).passed).toBe(true);
  });

  it("does not extend the bypass to users", () => {
    // `super_admin` is a staff role; nothing on the user side may borrow it,
    // even if a token somehow carried the string.
    const { passed, error } = run(authorize<"user">("customer"), user());

    expect(passed).toBe(false);
    expect(error).toMatchObject({ status: 403 });
  });

  it("admits a user holding the required user role", () => {
    expect(run(authorize<"user">("customer"), user("customer")).passed).toBe(
      true,
    );
  });

  it("answers 401, not 403, when there is no principal at all", () => {
    // Only reachable if a router mounted `authorize` without `authenticate`.
    // A 403 would say "this route exists and you are not allowed"; a 401 says
    // nothing (ADR-0019 §1).
    const { passed, error } = run(authorize("admin"), null);

    expect(passed).toBe(false);
    expect(error).toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  });
});
