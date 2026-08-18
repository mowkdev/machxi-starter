import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  POPULATIONS,
  SORT_DIRECTIONS,
  STAFF_ROLES,
  STAFF_STATUSES,
  SUPER_ADMIN_ROLE,
  USER_ROLES,
  USER_STATUSES,
  type Population,
  type Role,
  type StaffRole,
  type StaffStatus,
  type UserRole,
  type UserStatus,
} from "../index.js";

/**
 * The enums are the one place where the database, validation and the UIs must
 * agree (ADR-0023), so these tests pin the values themselves. A change here is
 * a migration (`ALTER TYPE … ADD VALUE`) plus a contracts release, and the
 * failing assertion is the reminder.
 */
describe("enums", () => {
  it("declares the two populations (ADR-0017)", () => {
    expect(POPULATIONS).toEqual(["staff", "user"]);
  });

  it("declares the staff roles and statuses", () => {
    expect(STAFF_ROLES).toEqual(["super_admin", "admin", "manager", "editor"]);
    expect(STAFF_STATUSES).toEqual(["active", "invited", "disabled"]);
  });

  it("declares the user roles and statuses", () => {
    expect(USER_ROLES).toEqual(["customer"]);
    expect(USER_STATUSES).toEqual([
      "active",
      "pending_verification",
      "disabled",
    ]);
  });

  it("names the role that bypasses every staff role check (ADR-0019)", () => {
    expect(SUPER_ADMIN_ROLE).toBe("super_admin");
    expect(STAFF_ROLES).toContain(SUPER_ADMIN_ROLE);
  });

  it("keeps the two populations disjoint in their statuses", () => {
    expect(STAFF_STATUSES).toContain("invited");
    expect(USER_STATUSES).not.toContain("invited");
    expect(USER_STATUSES).toContain("pending_verification");
    expect(STAFF_STATUSES).not.toContain("pending_verification");
  });

  it("has no duplicate members, which Postgres would reject in a pgEnum", () => {
    for (const values of [
      POPULATIONS,
      STAFF_ROLES,
      STAFF_STATUSES,
      USER_ROLES,
      USER_STATUSES,
      SORT_DIRECTIONS,
    ]) {
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("feeds z.enum directly, which is what module schemas rely on", () => {
    const schema = z.enum(STAFF_ROLES);

    expect(schema.parse("admin")).toBe("admin");
    expect(schema.safeParse("customer").success).toBe(false);
  });

  it("derives the unions from the arrays rather than restating them", () => {
    const population: Population = "staff";
    const staffRole: StaffRole = "manager";
    const userRole: UserRole = "customer";
    const staffStatus: StaffStatus = "invited";
    const userStatus: UserStatus = "pending_verification";
    const anyRole: Role = staffRole;

    expect([
      population,
      staffRole,
      userRole,
      staffStatus,
      userStatus,
      anyRole,
    ]).toHaveLength(6);
  });
});
