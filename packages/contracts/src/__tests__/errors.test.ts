import { describe, expect, it } from "vitest";

import { ERROR_CODES, type ErrorCode } from "../index.js";

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
      ]),
    );
  });

  it("covers the domain conflicts the modules own", () => {
    expect(ERROR_CODES).toEqual(
      expect.arrayContaining([
        "USER_EMAIL_TAKEN",
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
