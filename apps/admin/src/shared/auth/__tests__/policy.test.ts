import type { StaffPrincipalResource, StaffRole } from "@repo/contracts";
import { describe, expect, it } from "vitest";

import { can } from "..";
import { RESOURCE_POLICY, type ResourcePolicy } from "../policy";

/**
 * The policy table against the guards it transcribes (ADR-0042, ADR-0036).
 *
 * **What this test is, and what it is not.** It is a transcription check: the
 * fixture below is read off every `authorize(` call site in `apps/api` and off
 * no prose, this ADR's included, and it asserts that `RESOURCE_POLICY` equals
 * it. It **cannot** detect a change in `apps/api` — nothing can, from here;
 * `apps/admin` may not import from `apps/api` and the guards are not in
 * `@repo/contracts` — and claiming otherwise would be the mitigation lying.
 *
 * What it buys is exactly two things, and they are worth the file: it converts
 * a silent one-file edit into a deliberate two-file one, and it puts the
 * transcription somewhere a reviewer of an `authorize` change can be pointed
 * at. **An `authorize(` grep with no match in the fixture is the review question
 * this arrangement is built to provoke.**
 *
 * The prose is the unreliable copy and that is not hypothetical:
 * `admin.router.ts`'s own comment said the users router narrows "four" writing
 * routes and ADR-0019's D1.9 amendment says "three", where `users.routes.ts` in
 * fact narrows five. ADR-0019 is frozen, so its miscount cannot be corrected at
 * all — which is the strongest possible argument for transcribing the calls.
 */

/**
 * Transcribed 2026-08-20 (`D4.3`) from:
 *
 * - `apps/api/src/routes/admin.router.ts`
 *   - `router.use("/profile", …)` — no `authorize` at all
 *   - `router.use("/staff", authorize("admin"), …)`
 *   - `router.use("/users", authorize("admin", "manager"), …)`
 * - `apps/api/src/modules/staff/staff.routes.ts` — no `authorize(` call
 * - `apps/api/src/modules/users/users.routes.ts` — five `authorize("admin")`:
 *   `POST /`, `PATCH /:id`, `POST /:id/sessions/revoke`, `POST /:id/password`,
 *   `DELETE /:id`
 */
const TRANSCRIBED_FROM_ROUTERS: ResourcePolicy = {
  staff: {
    read: ["admin"],
    create: ["admin"],
    update: ["admin"],
    delete: ["admin"],
    setPassword: ["admin"],
    revokeSessions: ["admin"],
  },
  users: {
    read: ["admin", "manager"],
    create: ["admin"],
    update: ["admin"],
    delete: ["admin"],
    setPassword: ["admin"],
    revokeSessions: ["admin"],
  },
};

const staff = (...roles: readonly StaffRole[]): StaffPrincipalResource => ({
  kind: "staff",
  id: "0198c1f0-0000-7000-8000-0000000000aa",
  email: "operator@machxi.local",
  firstName: "Ops",
  lastName: "Operator",
  roles,
});

const ACTIONS = [
  "read",
  "create",
  "update",
  "delete",
  "setPassword",
  "revokeSessions",
] as const;

describe("RESOURCE_POLICY", () => {
  it("equals the guards transcribed from the routers", () => {
    expect(RESOURCE_POLICY).toEqual(TRANSCRIBED_FROM_ROUTERS);
  });

  it("has no entry for a resource no role gates", () => {
    /*
     * `/admin/profile` mounts with no `authorize` — every staff role may read
     * its own account and change its own password (ADR-0019 §3, ADR-0027). An
     * entry claiming otherwise would break the config-declares-what-exists rule
     * in the direction that costs an operator their own profile page.
     */
    expect(Object.keys(RESOURCE_POLICY)).toEqual(["staff", "users"]);
  });
});

describe("can(principal, action, resource)", () => {
  it("answers the role mounts, per resource", () => {
    // The whole point of the users row: read is wider than every write.
    expect(can(staff("manager"), "read", "users")).toBe(true);
    expect(can(staff("manager"), "create", "users")).toBe(false);
    expect(can(staff("manager"), "delete", "users")).toBe(false);

    // …and staff is uniformly `admin`, so a manager is offered nothing here.
    expect(can(staff("manager"), "read", "staff")).toBe(false);
    expect(can(staff("admin"), "read", "staff")).toBe(true);
    expect(can(staff("admin"), "delete", "staff")).toBe(true);
  });

  it("lets super_admin through everything, on the one line that says so", () => {
    // ADR-0019's bypass, mirrored rather than listed in each row — which is why
    // it is worth asserting: a table that listed it would drift a row at a time.
    expect(can(staff("super_admin"), "delete", "staff")).toBe(true);
    expect(can(staff("super_admin"), "create", "users")).toBe(true);
  });

  it("refuses an editor everything, by absence rather than by a rule", () => {
    expect(can(staff("editor"), "read", "staff")).toBe(false);
    expect(can(staff("editor"), "read", "users")).toBe(false);
  });

  it("leaves deny-by-default with no live case, because the table is complete", () => {
    /*
     * The `Partial` record exists so absence is expressible and `can`'s `?? []`
     * answers it — an action absent from a row is allowed to `super_admin`
     * alone (ADR-0019 §Rules, read from the client side). No row is missing one
     * today, and that is the property worth pinning rather than the fallback:
     * **completeness is what makes the fixture above a transcription.** A row
     * that quietly lost an action would make the table describe a smaller API
     * than the one that exists, and the gating rule — which is narrower than
     * the table (see `allowedCapabilities`) — would silently follow it.
     */
    for (const resource of ["staff", "users"] as const)
      for (const action of ACTIONS)
        expect(
          RESOURCE_POLICY[resource][action],
          `${resource}.${action}`,
        ).toBeDefined();
  });

  it("answers false for a principal that is not there yet", () => {
    /*
     * And that `false` means "not yet known", which is safe for rendering — an
     * affordance a tick late is a flicker — and unsafe for anything
     * irreversible. The rule ADR-0042 leaves behind is that no navigation,
     * redirect or one-shot decision may be taken on it; the shell's loading gate
     * is what preserves that.
     */
    expect(can(null, "read", "users")).toBe(false);
  });

  it("answers false for a non-staff principal, so the predicate is total", () => {
    // Unreachable in this app — the client is pinned to `/api/v1/admin`
    // (ADR-0033) — and written so `can` never has to be generic over
    // populations the way `authorize` is.
    expect(
      can(
        {
          kind: "user",
          id: "0198c1f0-0000-7000-8000-0000000000bb",
          email: "cara@example.test",
          firstName: null,
          lastName: null,
          roles: ["customer"],
        },
        "read",
        "users",
      ),
    ).toBe(false);
  });
});
