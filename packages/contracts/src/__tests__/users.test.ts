import { describe, expect, it } from "vitest";

import {
  changePasswordBody,
  createUserBody,
  listUsersQuery,
  MIN_PASSWORD_LENGTH,
  updateProfileBody,
  updateUserBody,
} from "../index.js";

const password = "a".repeat(MIN_PASSWORD_LENGTH);

describe("createUserBody", () => {
  it("needs only an email and a password", () => {
    expect(
      createUserBody.safeParse({ email: "anna@acme.com", password }).success,
    ).toBe(true);
  });

  it("lets an admin set status and roles, unlike self-registration", () => {
    const result = createUserBody.safeParse({
      email: "anna@acme.com",
      password,
      status: "pending_verification",
      roles: ["customer"],
    });

    expect(result.success).toBe(true);
  });

  it("rejects a staff role or a staff status", () => {
    expect(
      createUserBody.safeParse({
        email: "anna@acme.com",
        password,
        roles: ["admin"],
      }).success,
    ).toBe(false);
    expect(
      createUserBody.safeParse({
        email: "anna@acme.com",
        password,
        status: "invited",
      }).success,
    ).toBe(false);
  });
});

describe("updateUserBody", () => {
  it("accepts null to clear a nullable name, which undefined cannot express", () => {
    const result = updateUserBody.safeParse({ firstName: null });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ firstName: null });
  });

  it("rejects an empty patch", () => {
    expect(updateUserBody.safeParse({}).success).toBe(false);
  });

  it("does not accept an email or password change", () => {
    expect(updateUserBody.safeParse({ email: "new@acme.com" }).success).toBe(
      false,
    );
    expect(updateUserBody.safeParse({ password }).success).toBe(false);
  });
});

describe("updateProfileBody", () => {
  it("accepts the fields a user owns", () => {
    expect(
      updateProfileBody.safeParse({ firstName: "Anna", lastName: null })
        .success,
    ).toBe(true);
  });

  it("gives a user no way to change their own status or roles", () => {
    expect(updateProfileBody.safeParse({ status: "active" }).success).toBe(
      false,
    );
    expect(updateProfileBody.safeParse({ roles: ["customer"] }).success).toBe(
      false,
    );
  });

  it("rejects an empty patch", () => {
    expect(updateProfileBody.safeParse({}).success).toBe(false);
  });
});

describe("changePasswordBody", () => {
  it("accepts a current password that predates the policy", () => {
    expect(
      changePasswordBody.safeParse({
        currentPassword: "short",
        newPassword: password,
      }).success,
    ).toBe(true);
  });

  it("holds the new password to the policy", () => {
    expect(
      changePasswordBody.safeParse({
        currentPassword: "short",
        newPassword: "alsoshort",
      }).success,
    ).toBe(false);
  });

  it("refuses a no-op change and blames the new password", () => {
    const result = changePasswordBody.safeParse({
      currentPassword: password,
      newPassword: password,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["newPassword"]);
  });

  it("requires both fields", () => {
    expect(
      changePasswordBody.safeParse({ newPassword: password }).success,
    ).toBe(false);
    expect(
      changePasswordBody.safeParse({ currentPassword: password }).success,
    ).toBe(false);
  });
});

describe("listUsersQuery", () => {
  it("filters deleted accounts by presence only", () => {
    expect(
      listUsersQuery.parse({ filter: { deletedAt: { null: "false" } } })
        .filters,
    ).toEqual([{ field: "deletedAt", op: "null", value: false }]);
    expect(
      listUsersQuery.safeParse({ filter: { deletedAt: { gte: "2026-01-01" } } })
        .success,
    ).toBe(false);
  });

  it("accepts the user statuses and rejects the staff ones", () => {
    expect(
      listUsersQuery.safeParse({ filter: { status: "pending_verification" } })
        .success,
    ).toBe(true);
    expect(
      listUsersQuery.safeParse({ filter: { status: "invited" } }).success,
    ).toBe(false);
  });

  it("parses a date range on createdAt into Date values", () => {
    const result = listUsersQuery.parse({
      filter: { createdAt: { gte: "2026-01-01", lt: "2026-02-01" } },
    });

    expect(result.filters).toHaveLength(2);
    expect(result.filters.every((filter) => filter.value instanceof Date)).toBe(
      true,
    );
  });
});
