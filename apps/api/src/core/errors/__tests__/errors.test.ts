import { ERROR_CODES } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  appError,
  conflict,
  forbidden,
  internal,
  isAppError,
  isExposed,
  malformedJson,
  notFound,
  payloadTooLarge,
  rateLimited,
  toErrorDetails,
  toValidationError,
  unauthenticated,
  unavailable,
  validation,
} from "../index.js";

/**
 * ADR-0013: one branded error type, factories instead of subclasses, and
 * identification by `code` — never by `instanceof`.
 */

describe("appError", () => {
  it("is a real Error, so a stack and `throw` behave normally", () => {
    const error = appError({ status: 404, code: "NOT_FOUND", message: "gone" });

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("gone");
    expect(error.stack).toBeDefined();
  });

  it("carries its data as readable properties", () => {
    const error = appError({
      status: 409,
      code: "USER_EMAIL_TAKEN",
      message: "taken",
      details: [{ path: "email", message: "already used" }],
    });

    expect(error.status).toBe(409);
    expect(error.code).toBe("USER_EMAIL_TAKEN");
    expect(error.details).toEqual([{ path: "email", message: "already used" }]);
  });

  it("keeps the cause for the log line", () => {
    const cause = new Error("driver blew up");

    expect(appError({ status: 500, code: "INTERNAL_ERROR", message: "x", cause }).cause).toBe(
      cause,
    );
  });
});

describe("isAppError", () => {
  it("recognises an AppError", () => {
    expect(isAppError(notFound())).toBe(true);
  });

  it.each([
    ["a plain Error", new Error("nope")],
    ["a look-alike object", { status: 404, code: "NOT_FOUND", message: "x" }],
    ["null", null],
    ["a string", "NOT_FOUND"],
  ])("rejects %s", (_label, value) => {
    expect(isAppError(value)).toBe(false);
  });

  it("survives a second copy of the module, which `instanceof` would not", () => {
    // The brand is a registered symbol, so two module instances agree on it.
    const branded = { [Symbol.for("machxi.appError")]: true };

    expect(isAppError(branded)).toBe(true);
  });
});

describe("factories", () => {
  it.each([
    [validation(), 400, "VALIDATION_ERROR"],
    [malformedJson(), 400, "MALFORMED_JSON"],
    [unauthenticated(), 401, "UNAUTHENTICATED"],
    [forbidden(), 403, "FORBIDDEN"],
    [notFound(), 404, "NOT_FOUND"],
    [conflict(), 409, "CONFLICT"],
    [payloadTooLarge(), 413, "PAYLOAD_TOO_LARGE"],
    [rateLimited(30), 429, "RATE_LIMITED"],
    [internal(), 500, "INTERNAL_ERROR"],
    [unavailable(), 503, "SERVICE_UNAVAILABLE"],
  ])("maps to the status and code ADR-0013 fixes", (error, status, code) => {
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
    expect(ERROR_CODES).toContain(error.code);
  });

  it("lets a module narrow the code while keeping the status", () => {
    // The shape every `<module>.errors.ts` factory takes (ADR-0013).
    const invalidCredentials = () =>
      unauthenticated("Invalid email or password", "AUTH_INVALID_CREDENTIALS");

    expect(invalidCredentials().status).toBe(401);
    expect(invalidCredentials().code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("exposes every message except the internal one", () => {
    expect(isExposed(notFound())).toBe(true);
    expect(isExposed(internal())).toBe(false);
  });

  it("carries the retry delay in details, not only in a header", () => {
    expect(rateLimited(42).details).toEqual([
      { code: "retryAfter", message: "42" },
    ]);
  });

  it("omits `details` rather than sending an empty array", () => {
    expect("details" in notFound()).toBe(false);
  });
});

describe("toErrorDetails", () => {
  const schema = z.object({
    email: z.email(),
    roles: z.array(z.enum(["admin"])),
  });

  it("renders a dotted path per rejected field", () => {
    const result = schema.safeParse({ email: "nope", roles: ["ghost"] });

    expect(result.success).toBe(false);

    if (result.success) return;

    const details = toErrorDetails(result.error.issues);

    expect(details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "email" }),
        expect.objectContaining({ path: "roles.0" }),
      ]),
    );
    expect(details.every((detail) => typeof detail.code === "string")).toBe(true);
  });

  it("omits `path` for an issue about the object as a whole", () => {
    const result = z.object({}).strict().safeParse("not an object");

    expect(result.success).toBe(false);

    if (result.success) return;

    expect(toErrorDetails(result.error.issues)[0]).not.toHaveProperty("path");
  });

  it("builds a 400 VALIDATION_ERROR from the issues", () => {
    const result = schema.safeParse({});

    expect(result.success).toBe(false);

    if (result.success) return;

    const error = toValidationError(result.error.issues);

    expect(error.status).toBe(400);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details).toHaveLength(2);
  });
});
