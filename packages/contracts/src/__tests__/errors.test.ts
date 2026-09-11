import { describe, expect, it } from "vitest";

import { ERROR_CODES, isErrorCode, type ErrorCode } from "../index.js";

/**
 * Error codes are the client-facing contract and the future i18n key
 * (ADR-0013), so the set is asserted explicitly: adding one is additive and
 * intentional, renaming or removing one breaks clients.
 */
describe("ERROR_CODES", () => {
  it("covers every generic status family the error middleware maps", () => {
    expect(ERROR_CODES).toEqual(
      expect.arrayContaining([
        "VALIDATION_ERROR",
        "MALFORMED_JSON",
        "PAYLOAD_TOO_LARGE",
        "UNAUTHENTICATED",
        "FORBIDDEN",
        "NOT_FOUND",
        "ROUTE_NOT_FOUND",
        "CONFLICT",
        "RATE_LIMITED",
        "INTERNAL_ERROR",
        "SERVICE_UNAVAILABLE",
      ]),
    );
  });

  it("covers the authentication outcomes a client must tell apart (ADR-0018)", () => {
    expect(ERROR_CODES).toEqual(
      expect.arrayContaining([
        "AUTH_INVALID_CREDENTIALS",
        "AUTH_TOKEN_INVALID",
        "AUTH_TOKEN_EXPIRED",
        "AUTH_SESSION_REVOKED",
        "AUTH_INVALID_REFRESH_TOKEN",
        "AUTH_REFRESH_REUSED",
        "AUTH_ACCOUNT_DISABLED",
        "AUTH_CURRENT_PASSWORD_INVALID",
        "AUTH_IMPERSONATION_REFUSED",
        "CSRF_TOKEN_INVALID",
      ]),
    );
  });

  it("names the impersonation refusal once, for the class (ADR-0057 §5)", () => {
    // One code for the three takeover-enabling operations, not one each: the
    // client already knows which dialog it opened, so a code per operation
    // would be enum growth with no reader.
    expect(ERROR_CODES).toContain("AUTH_IMPERSONATION_REFUSED");
    expect(
      ERROR_CODES.filter((code) => code.includes("IMPERSONATION")),
    ).toHaveLength(1);
  });

  it("names the two refusals a sign-in with Google makes and login does not (ADR-0072 §1)", () => {
    // Two and no more: every other refusal on the callback reuses a code the
    // catalogues already carry (ADR-0072 §2, amended at `D19.2`).
    expect(ERROR_CODES).toContain("AUTH_FEDERATED_SIGNUP_CLOSED");
    expect(ERROR_CODES).toContain("AUTH_FEDERATED_LINK_REQUIRED");
    expect(
      ERROR_CODES.filter((code) => code.startsWith("AUTH_FEDERATED_")),
    ).toHaveLength(2);
  });

  it("names the two conflicts an account's own ways in can meet (ADR-0072 §3)", () => {
    // A Google account another account signs in with, and the last way into
    // a passwordless account — both `409`s, both about state rather than who
    // is asking.
    expect(ERROR_CODES).toEqual(
      expect.arrayContaining(["AUTH_IDENTITY_TAKEN", "AUTH_LAST_CREDENTIAL"]),
    );
  });

  it("covers the domain conflicts the modules own", () => {
    expect(ERROR_CODES).toEqual(
      expect.arrayContaining([
        "USER_EMAIL_TAKEN",
        "USER_DELETED",
        "STAFF_EMAIL_TAKEN",
        "STAFF_LAST_SUPER_ADMIN",
      ]),
    );
  });

  it("names the failed re-presentation of the caller's own password (ADR-0027)", () => {
    // An auth code, not a users-module one: four endpoints across both
    // populations ask the same question about the same caller, and none of
    // them is about the `users` aggregate.
    expect(ERROR_CODES).toContain("AUTH_CURRENT_PASSWORD_INVALID");
    expect(ERROR_CODES).not.toContain("USER_CURRENT_PASSWORD_INVALID");
  });

  it("keeps email conflicts per population — emails are unique within one, not across", () => {
    expect(ERROR_CODES).toContain("USER_EMAIL_TAKEN");
    expect(ERROR_CODES).toContain("STAFF_EMAIL_TAKEN");
  });

  it("is free of duplicates", () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it("uses SCREAMING_SNAKE_CASE throughout (ADR-0013)", () => {
    for (const code of ERROR_CODES) {
      expect(code).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/);
    }
  });

  it("derives ErrorCode from the array rather than restating it", () => {
    const code: ErrorCode = "AUTH_REFRESH_REUSED";

    expect(ERROR_CODES).toContain(code);
  });
});

describe("isErrorCode", () => {
  it("recognises every declared code", () => {
    for (const code of ERROR_CODES) expect(isErrorCode(code)).toBe(true);
  });

  it("refuses a code this build does not declare", () => {
    // What a bundle deployed before a code existed sees on the wire (`D13.1`).
    // The answer is what sends `@repo/api-client` to the status family instead
    // of throwing the whole envelope away. The placeholder is invented rather
    // than borrowed from the next deliverable: `AUTH_IMPERSONATION_REFUSED`
    // stood here until `D13.3` declared it, at which point this assertion was
    // asserting the opposite of the truth.
    expect(isErrorCode("AUTH_SOMETHING_A_LATER_DELIVERABLE_ADDS")).toBe(false);
    expect(isErrorCode("")).toBe(false);
  });
});
