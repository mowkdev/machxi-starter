import { describe, expect, it } from "vitest";

import {
  loginBody,
  maxPasswordLength,
  maxRefreshTokenLength,
  minPasswordLength,
  refreshBody,
  registerBody,
} from "../index.js";

const password = "a".repeat(minPasswordLength);

describe("loginBody", () => {
  it("normalises the email so a stored value stays canonical", () => {
    const result = loginBody.parse({
      email: "  Anna@ACME.com  ",
      password: "hunter2",
    });

    expect(result.email).toBe("anna@acme.com");
  });

  it("accepts a password that would fail the policy (ADR-0018 §Login)", () => {
    // Applying the policy here would answer "is this one of ours?" with a 400
    // before any credential check, and would lock out accounts whose password
    // predates a policy change.
    expect(
      loginBody.safeParse({ email: "anna@acme.com", password: "short" })
        .success,
    ).toBe(true);
  });

  it("still bounds the password, so an unbounded body cannot buy argon2 work", () => {
    const tooLong = "a".repeat(maxPasswordLength + 1);

    expect(
      loginBody.safeParse({ email: "anna@acme.com", password: tooLong })
        .success,
    ).toBe(false);
    expect(
      loginBody.safeParse({ email: "anna@acme.com", password: "" }).success,
    ).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(
      loginBody.safeParse({ email: "anna", password: "hunter2" }).success,
    ).toBe(false);
  });

  it("rejects unknown keys, so a typo surfaces instead of being ignored", () => {
    const result = loginBody.safeParse({
      email: "anna@acme.com",
      password: "hunter2",
      population: "staff",
    });

    expect(result.success).toBe(false);
  });

  it("has no population field — the route segment decides that (ADR-0015)", () => {
    expect(Object.keys(loginBody.shape)).toEqual(["email", "password"]);
  });
});

describe("refreshBody", () => {
  it("accepts an opaque token without assuming its encoding", () => {
    expect(
      refreshBody.parse({ refreshToken: "  abc.def-ghi_jkl  " }).refreshToken,
    ).toBe("abc.def-ghi_jkl");
  });

  it("rejects an empty or oversized token", () => {
    expect(refreshBody.safeParse({ refreshToken: "" }).success).toBe(false);
    expect(refreshBody.safeParse({ refreshToken: "  " }).success).toBe(false);
    expect(
      refreshBody.safeParse({
        refreshToken: "a".repeat(maxRefreshTokenLength + 1),
      }).success,
    ).toBe(false);
  });
});

describe("registerBody", () => {
  it("accepts an email and password alone — names are nullable on users (ADR-0017)", () => {
    const result = registerBody.safeParse({ email: "anna@acme.com", password });

    expect(result.success).toBe(true);
    expect(result.data?.firstName).toBeUndefined();
  });

  it("enforces the password policy on a new password (ADR-0018)", () => {
    expect(
      registerBody.safeParse({
        email: "anna@acme.com",
        password: "a".repeat(minPasswordLength - 1),
      }).success,
    ).toBe(false);
    expect(
      registerBody.safeParse({
        email: "anna@acme.com",
        password: "a".repeat(maxPasswordLength + 1),
      }).success,
    ).toBe(false);
  });

  it("does not trim the password — a trailing space is a password character", () => {
    const padded = `${password} `;

    expect(
      registerBody.parse({ email: "anna@acme.com", password: padded }).password,
    ).toBe(padded);
  });

  it("trims names and rejects a blank one", () => {
    expect(
      registerBody.parse({
        email: "anna@acme.com",
        password,
        firstName: "  Anna  ",
      }).firstName,
    ).toBe("Anna");
    expect(
      registerBody.safeParse({
        email: "anna@acme.com",
        password,
        firstName: "   ",
      }).success,
    ).toBe(false);
  });

  it("offers no way to ask for a role or a status", () => {
    expect(Object.keys(registerBody.shape)).toEqual([
      "email",
      "password",
      "firstName",
      "lastName",
    ]);
  });
});
