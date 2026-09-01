import { describe, expect, it } from "vitest";

import type {
  StaffPrincipalResource,
  UserPrincipalResource,
} from "../index.js";
import {
  changePasswordBody,
  loginBody,
  MAX_PASSWORD_LENGTH,
  MAX_REFRESH_TOKEN_LENGTH,
  MIN_PASSWORD_LENGTH,
  refreshBody,
  registerBody,
  setPasswordBody,
} from "../index.js";

const password = "a".repeat(MIN_PASSWORD_LENGTH);

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
    const tooLong = "a".repeat(MAX_PASSWORD_LENGTH + 1);

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
        refreshToken: "a".repeat(MAX_REFRESH_TOKEN_LENGTH + 1),
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
        password: "a".repeat(MIN_PASSWORD_LENGTH - 1),
      }).success,
    ).toBe(false);
    expect(
      registerBody.safeParse({
        email: "anna@acme.com",
        password: "a".repeat(MAX_PASSWORD_LENGTH + 1),
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

describe("refreshBody — cookie transport (ADR-0029)", () => {
  it("accepts an empty body, because the token may be in a cookie", () => {
    // The server reads `__Secure-machxi.refresh` when the field is absent. The
    // schema cannot express "one of these two" — the other one is not a field —
    // so "neither" is refused by the controller, not here.
    expect(refreshBody.safeParse({}).success).toBe(true);
  });

  it("still accepts and bounds a token in the body", () => {
    expect(refreshBody.safeParse({ refreshToken: "abc" }).success).toBe(true);
    expect(
      refreshBody.safeParse({ refreshToken: "a".repeat(1000) }).success,
    ).toBe(false);
  });

  it("still rejects an unknown field", () => {
    expect(
      refreshBody.safeParse({ refreshToken: "abc", transport: "cookie" })
        .success,
    ).toBe(false);
  });
});

describe("setPasswordBody", () => {
  it("takes the subject's new password and the actor's own current one", () => {
    expect(
      setPasswordBody.safeParse({ password, currentPassword: "short" }).success,
    ).toBe(true);
  });

  it("holds the new password to the policy", () => {
    expect(
      setPasswordBody.safeParse({
        password: "alsoshort",
        currentPassword: password,
      }).success,
    ).toBe(false);
  });

  it("requires the actor to re-present their own password (ADR-0027)", () => {
    // The step-up check the whole endpoint rests on: without this field a
    // stolen admin access token is an account-takeover engine.
    expect(setPasswordBody.safeParse({ password }).success).toBe(false);
  });

  it("allows the two values to be equal", () => {
    // They belong to two different people, so a "must differ" rule would only
    // report whether the actor and the subject share a password.
    expect(
      setPasswordBody.safeParse({ password, currentPassword: password })
        .success,
    ).toBe(true);
  });

  it("rejects an unknown field rather than ignoring it", () => {
    expect(
      setPasswordBody.safeParse({
        password,
        currentPassword: password,
        newPassword: password,
      }).success,
    ).toBe(false);
  });
});

/**
 * The impersonation fact on the wire (ADR-0057 §4).
 *
 * `UserPrincipalResource` is a hand-written resource type, not a zod schema —
 * ADR-0023's rule that requests get schemas and responses get types — so what
 * is checked here is what a resource type can be checked for: the shape both
 * ways across a JSON round trip, which is the only form a client ever sees it
 * in, plus two compile-time facts about the staff resource: that it has no
 * such key, and that assigning one to it is refused. A response schema beside
 * the mapper would be a second description of the same shape, drifting from
 * the one that actually runs.
 */
describe("UserPrincipalResource — impersonatedBy", () => {
  const ordinary: UserPrincipalResource = {
    kind: "user",
    id: "01948f1a-0000-7000-8000-000000000001",
    email: "anna@acme.com",
    firstName: "Anna",
    lastName: null,
    roles: ["customer"],
  };

  const impersonated: UserPrincipalResource = {
    ...ordinary,
    impersonatedBy: {
      id: "01948f1a-0000-7000-8000-0000000000ff",
      email: "support@machxi.local",
    },
  };

  it("is absent on an ordinary session, key and all", () => {
    // Optional rather than `| null`, so a bundle that predates impersonation
    // meets exactly the payload it always met (ADR-0015: additive).
    const wire = JSON.parse(JSON.stringify(ordinary)) as UserPrincipalResource;

    expect("impersonatedBy" in wire).toBe(false);
    expect(wire.impersonatedBy).toBeUndefined();
  });

  it("names the staff member on an impersonated one, and nothing more", () => {
    const wire = JSON.parse(
      JSON.stringify(impersonated),
    ) as UserPrincipalResource;

    expect(wire.impersonatedBy).toEqual({
      id: "01948f1a-0000-7000-8000-0000000000ff",
      email: "support@machxi.local",
    });
    // An id for the trail and an email for the banner's sentence. No roles:
    // nothing on the customer app authorises against the staff member, and a
    // role list its screens could read is an invitation to.
    expect(Object.keys(wire.impersonatedBy ?? {})).toEqual(["id", "email"]);
  });

  it("leaves the customer's own identity untouched", () => {
    // The banner names both, which only works if the principal is still the
    // customer: impersonation adds an actor, it does not swap the subject.
    expect(impersonated.id).toBe(ordinary.id);
    expect(impersonated.email).toBe(ordinary.email);
    expect(impersonated.kind).toBe("user");
  });

  it("has no staff counterpart — the mint is /admin/users/:id only", () => {
    const staffPrincipal: StaffPrincipalResource = {
      kind: "staff",
      id: "01948f1a-0000-7000-8000-0000000000aa",
      email: "support@machxi.local",
      firstName: "Sam",
      lastName: "Support",
      roles: ["admin"],
    };

    // The type-level half: the field is not on the staff resource at all, so
    // a banner reading `principal.impersonatedBy` cannot compile against one.
    const staffCarriesIt: "impersonatedBy" extends keyof StaffPrincipalResource
      ? true
      : false = false;

    // And the other direction — absent from `keyof` is not the same as
    // refused, and it is the refusal that keeps a mapper from quietly putting
    // an actor on a staff principal (ADR-0057 §1: the mint is
    // `/admin/users/:id` only).
    const withActor: StaffPrincipalResource = {
      ...staffPrincipal,
      // @ts-expect-error a staff principal is never impersonated.
      impersonatedBy: { id: staffPrincipal.id, email: staffPrincipal.email },
    };

    expect(staffCarriesIt).toBe(false);
    expect(withActor.kind).toBe("staff");
    expect(staffPrincipal.kind).toBe("staff");
  });
});
