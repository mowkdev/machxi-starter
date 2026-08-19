import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { isAppError, type AppError } from "../../errors/index.js";
import { validate, type ValidationSchemas } from "../validate.js";

/**
 * ADR-0011: controllers never read `req.body` or `req.query`; they read what a
 * schema produced. Invalid input never reaches a service.
 */

const schemas = {
  params: z.object({ id: z.uuid() }),
  query: z.strictObject({ limit: z.coerce.number().int().max(100) }),
  body: z.strictObject({ email: z.email() }),
} as const;

const run = (
  req: Partial<Request>,
  /** Defaults to the shared schema; the absent-body case needs its own. */
  against: ValidationSchemas = schemas,
): {
  request: Partial<Request>;
  next: ReturnType<typeof vi.fn>;
  error?: unknown;
} => {
  const next = vi.fn();
  const request = { params: {}, query: {}, body: {}, ...req };

  try {
    validate(against)(request as Request, {} as Response, next);
  } catch (error) {
    return { request, next, error };
  }

  return { request, next };
};

const valid = {
  params: { id: "0197e2a0-0000-7000-8000-000000000000" },
  query: { limit: "20" },
  body: { email: "a@b.co" },
} as const;

describe("validate", () => {
  it("puts the parsed values on req.valid and continues", () => {
    const { request, next, error } = run(valid);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
    expect(request.valid).toEqual({
      params: valid.params,
      query: { limit: 20 },
      body: valid.body,
    });
  });

  it("hands the controller coerced values, not raw strings", () => {
    expect(run(valid).request.valid.query.limit).toBe(20);
  });

  it("leaves an unvalidated part undefined rather than copying the raw one", () => {
    const next = vi.fn();
    const request = {
      params: {},
      query: {},
      body: { note: "raw" },
    } as unknown as Request;

    validate({ params: z.object({}) })(request, {} as Response, next);

    expect(request.valid.body).toBeUndefined();
  });

  it("throws a 400 VALIDATION_ERROR that the error middleware renders", () => {
    const { error } = run({ ...valid, body: { email: "nope" } });

    expect(isAppError(error)).toBe(true);
    expect((error as AppError).status).toBe(400);
    expect((error as AppError).code).toBe("VALIDATION_ERROR");
  });

  it("reports issues from all three parts in one response", () => {
    // A client that sent a bad id *and* a bad body should learn both at once,
    // not one round trip at a time.
    const { error } = run({
      params: { id: "not-a-uuid" },
      query: { limit: "1000" },
      body: { email: "nope" },
    });

    expect((error as AppError).details?.map((detail) => detail.path)).toEqual([
      "id",
      "limit",
      "email",
    ]);
  });

  it("treats an absent body as an empty one", () => {
    // A bodyless `POST` is a real request: a browser refreshing from its
    // cookie sends no body and no content type, and Express leaves `req.body`
    // undefined rather than `{}` (ADR-0029). A schema whose fields are all
    // optional must accept it.
    const optional = { body: z.strictObject({ note: z.string().optional() }) };
    const { request, next } = run({ ...valid, body: undefined }, optional);

    expect(next).toHaveBeenCalledOnce();
    expect(request.valid?.body).toEqual({});
  });

  it("names the missing fields when a required body is absent", () => {
    const { error } = run({ ...valid, body: undefined });

    expect((error as AppError).details?.map((detail) => detail.path)).toContain(
      "email",
    );
  });

  it("does not prefix paths with params/query/body", () => {
    // ADR-0013 defines `details[].path` as the field path the client used, so
    // a form can attach the message to its own field.
    const { error } = run({ ...valid, body: { email: "nope" } });

    expect((error as AppError).details?.[0]?.path).toBe("email");
  });

  it("rejects unknown body keys, which is how a typo surfaces", () => {
    const { error } = run({ ...valid, body: { email: "a@b.co", admin: true } });

    expect(isAppError(error)).toBe(true);
  });

  it("does not call next when validation failed", () => {
    expect(run({ ...valid, body: {} }).next).not.toHaveBeenCalled();
  });

  it("does not write req.valid when validation failed", () => {
    expect(run({ ...valid, body: {} }).request.valid).toBeUndefined();
  });
});
