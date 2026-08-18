import { describe, expect, it } from "vitest";

import {
  createStaffBody,
  listStaffQuery,
  minPasswordLength,
  staffIdParams,
  updateStaffBody,
} from "../index.js";

const valid = {
  email: "anna@acme.com",
  password: "a".repeat(minPasswordLength),
  firstName: "Anna",
  lastName: "Meyer",
  roles: ["admin"],
};

describe("staffIdParams", () => {
  it("accepts a uuid and rejects anything else, so no malformed id reaches SQL", () => {
    expect(
      staffIdParams.safeParse({ id: "0199a1f4-4c2e-7c53-9c62-3e0f9d0f7f11" })
        .success,
    ).toBe(true);
    expect(staffIdParams.safeParse({ id: "1" }).success).toBe(false);
    expect(staffIdParams.safeParse({ id: "" }).success).toBe(false);
  });
});

describe("createStaffBody", () => {
  it("accepts a complete staff member", () => {
    expect(createStaffBody.safeParse(valid).success).toBe(true);
  });

  it("requires names — the staff table has them NOT NULL (ADR-0017)", () => {
    const { email, password, lastName, roles } = valid;

    expect(
      createStaffBody.safeParse({ email, password, lastName, roles }).success,
    ).toBe(false);
  });

  it("requires at least one role and rejects repeats", () => {
    expect(createStaffBody.safeParse({ ...valid, roles: [] }).success).toBe(
      false,
    );
    expect(
      createStaffBody.safeParse({ ...valid, roles: ["admin", "admin"] })
        .success,
    ).toBe(false);
  });

  it("rejects a role from the other population", () => {
    expect(
      createStaffBody.safeParse({ ...valid, roles: ["customer"] }).success,
    ).toBe(false);
  });

  it("lets validation accept super_admin — who may grant it is the service's call (ADR-0019)", () => {
    expect(
      createStaffBody.safeParse({ ...valid, roles: ["super_admin"] }).success,
    ).toBe(true);
  });

  it("enforces the password policy on the initial password", () => {
    expect(
      createStaffBody.safeParse({ ...valid, password: "short" }).success,
    ).toBe(false);
  });

  it("offers no way to set a status — new staff start active (ADR-0018)", () => {
    expect(
      createStaffBody.safeParse({ ...valid, status: "disabled" }).success,
    ).toBe(false);
  });
});

describe("updateStaffBody", () => {
  it("accepts a single field", () => {
    expect(updateStaffBody.safeParse({ status: "disabled" }).success).toBe(
      true,
    );
    expect(updateStaffBody.safeParse({ firstName: "Anne" }).success).toBe(true);
  });

  it("rejects an empty patch rather than performing a no-op write", () => {
    expect(updateStaffBody.safeParse({}).success).toBe(false);
  });

  it("does not accept an email change — that is its own flow", () => {
    expect(updateStaffBody.safeParse({ email: "new@acme.com" }).success).toBe(
      false,
    );
  });

  it("does not accept a password — changing another account's password is not a profile edit", () => {
    expect(
      updateStaffBody.safeParse({ password: "a".repeat(minPasswordLength) })
        .success,
    ).toBe(false);
  });

  it("rejects a status outside the staff enum", () => {
    expect(
      updateStaffBody.safeParse({ status: "pending_verification" }).success,
    ).toBe(false);
  });
});

describe("listStaffQuery", () => {
  it("defaults to the newest first", () => {
    expect(listStaffQuery.parse({}).sort).toEqual([
      { field: "createdAt", direction: "desc" },
    ]);
  });

  it("filters on status and searches with q", () => {
    const result = listStaffQuery.parse({
      filter: { status: { in: "active,invited" } },
      q: "anna",
    });

    expect(result.filters).toEqual([
      { field: "status", op: "in", value: ["active", "invited"] },
    ]);
    expect(result.q).toBe("anna");
  });

  it("refuses to sort or filter on a column that is not exposed", () => {
    expect(listStaffQuery.safeParse({ sort: "passwordHash" }).success).toBe(
      false,
    );
    expect(
      listStaffQuery.safeParse({ filter: { passwordHash: "x" } }).success,
    ).toBe(false);
  });

  it("does not filter on roles in v1 — staff_roles is a join table", () => {
    expect(
      listStaffQuery.safeParse({ filter: { roles: "admin" } }).success,
    ).toBe(false);
  });
});
