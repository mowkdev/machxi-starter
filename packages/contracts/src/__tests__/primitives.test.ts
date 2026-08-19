import { describe, expect, it } from "vitest";

import {
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  emailSchema,
  idSchema,
  nameSchema,
  passwordSchema,
  presentedPasswordSchema,
} from "../index.js";

describe("emailSchema", () => {
  it("trims and lower-cases before validating, not after", () => {
    // Order matters: validating first would reject a padded address outright.
    expect(emailSchema.parse("  Anna.Meyer@ACME.com  ")).toBe(
      "anna.meyer@acme.com",
    );
  });

  it("rejects an address that is not one", () => {
    for (const invalid of [
      "anna",
      "anna@",
      "@acme.com",
      "anna @acme.com",
      "",
    ]) {
      expect(emailSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("bounds the length at the RFC 5321 path limit", () => {
    const local = "a".repeat(MAX_EMAIL_LENGTH - "@acme.com".length);

    expect(emailSchema.safeParse(`${local}@acme.com`).success).toBe(true);
    expect(emailSchema.safeParse(`${local}a@acme.com`).success).toBe(false);
  });
});

describe("passwordSchema", () => {
  it("enforces the v1 policy of at least 12 characters (ADR-0018)", () => {
    expect(
      passwordSchema.safeParse("a".repeat(MIN_PASSWORD_LENGTH)).success,
    ).toBe(true);
    expect(
      passwordSchema.safeParse("a".repeat(MIN_PASSWORD_LENGTH - 1)).success,
    ).toBe(false);
  });

  it("bounds the length so a body cannot buy unbounded argon2 work (ADR-0020)", () => {
    expect(
      passwordSchema.safeParse("a".repeat(MAX_PASSWORD_LENGTH)).success,
    ).toBe(true);
    expect(
      passwordSchema.safeParse("a".repeat(MAX_PASSWORD_LENGTH + 1)).success,
    ).toBe(false);
  });

  it("never trims — a leading or trailing space is part of the password", () => {
    // Silently trimming would store a password the user cannot reproduce.
    const padded = `  ${"a".repeat(MIN_PASSWORD_LENGTH)}  `;

    expect(passwordSchema.parse(padded)).toBe(padded);
  });

  it("counts whitespace towards the minimum rather than discarding it", () => {
    expect(
      passwordSchema.safeParse(" ".repeat(MIN_PASSWORD_LENGTH)).success,
    ).toBe(true);
  });
});

describe("presentedPasswordSchema", () => {
  it("accepts anything non-empty within the bound, whatever the policy says", () => {
    // A credential being verified is not a credential being set: an account
    // whose password predates a policy change must still be able to log in.
    expect(presentedPasswordSchema.safeParse("short").success).toBe(true);
    expect(presentedPasswordSchema.safeParse("").success).toBe(false);
  });

  it("shares the upper bound with passwordSchema, so a valid password always fits", () => {
    expect(
      presentedPasswordSchema.safeParse("a".repeat(MAX_PASSWORD_LENGTH))
        .success,
    ).toBe(true);
    expect(
      presentedPasswordSchema.safeParse("a".repeat(MAX_PASSWORD_LENGTH + 1))
        .success,
    ).toBe(false);
  });
});

describe("nameSchema", () => {
  it("trims and requires something left over", () => {
    expect(nameSchema.parse("  Anna  ")).toBe("Anna");
    expect(nameSchema.safeParse("   ").success).toBe(false);
    expect(nameSchema.safeParse("").success).toBe(false);
  });

  it("is bounded", () => {
    expect(nameSchema.safeParse("a".repeat(MAX_NAME_LENGTH)).success).toBe(
      true,
    );
    expect(nameSchema.safeParse("a".repeat(MAX_NAME_LENGTH + 1)).success).toBe(
      false,
    );
  });
});

describe("idSchema", () => {
  it("lower-cases, so two spellings of one id compare equal", () => {
    // RFC 9562 writes a UUID lowercase and reads it case-insensitively, and
    // Postgres matches either — but a service comparing the string to an id
    // from a JWT compares *strings*. An uppercased id walked past
    // `staff.remove`'s self-deletion refusal until D2.4's review (ADR-0028
    // rule 4), which is why this is normalised at the edge rather than at each
    // comparison.
    expect(idSchema.parse("0199A1F4-4C2E-7C53-9C62-3E0F9D0F7F11")).toBe(
      "0199a1f4-4c2e-7c53-9c62-3e0f9d0f7f11",
    );
  });

  it("accepts a uuid of any version, including the v7 ids the db generates", () => {
    expect(
      idSchema.safeParse("0199a1f4-4c2e-7c53-9c62-3e0f9d0f7f11").success,
    ).toBe(true);
    expect(
      idSchema.safeParse("f47ac10b-58cc-4372-a567-0e02b2c3d479").success,
    ).toBe(true);
  });

  it("rejects anything that is not a uuid, so no malformed id reaches SQL", () => {
    for (const invalid of ["1", "", "0199a1f4-4c2e-7c53-9c62", "not-a-uuid"]) {
      expect(idSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
