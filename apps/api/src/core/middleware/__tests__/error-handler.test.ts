import { declaredErrorEnvelopeSchema } from "@repo/contracts";
import { createLogger } from "@repo/logger";
import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createRequestContext } from "../../context/index.js";
import type { ErrorReporter } from "../../reporting/index.js";
import {
  forbidden,
  internal,
  notFound,
  rateLimited,
  unavailable,
} from "../../errors/index.js";
import { createErrorHandler, toAppError } from "../error-handler.js";

/**
 * ADR-0013: one place decides the status, one place writes the body, and an
 * unexpected failure never reaches the client as a stack trace or a SQL string.
 */

const requestId = "01J0000000000000000000000A";

const fakeResponse = () => {
  const headers = new Map<string, string>();

  const res = {
    headersSent: false,
    statusCode: 200,
    headers,
    status: vi.fn((code: number) => {
      res.statusCode = code;

      return res;
    }),
    json: vi.fn((_body: unknown) => res),
    hasHeader: vi.fn((name: string) => headers.has(name.toLowerCase())),
    setHeader: vi.fn((name: string, value: string) => {
      headers.set(name.toLowerCase(), value);

      return res;
    }),
  };

  return res;
};

const handle = (
  error: unknown,
  {
    includeDebug = false,
    reporter,
  }: { includeDebug?: boolean; reporter?: ErrorReporter } = {},
) => {
  const res = fakeResponse();
  const next = vi.fn();
  const ctx = createRequestContext({
    requestId,
    logger: createLogger({ level: "silent" }),
  });

  createErrorHandler({
    includeDebug,
    logger: createLogger({ level: "silent" }),
    ...(reporter === undefined ? {} : { reporter }),
  })(
    error,
    { ctx } as Request,
    res as unknown as Response,
    next as unknown as NextFunction,
  );

  return { res, next, body: res.json.mock.calls[0]?.[0] as unknown };
};

describe("toAppError", () => {
  it("passes an AppError through untouched", () => {
    const error = forbidden();

    expect(toAppError(error)).toBe(error);
  });

  it("maps a ZodError to 400 VALIDATION_ERROR with details", () => {
    const result = z.object({ email: z.email() }).safeParse({ email: "x" });

    expect(result.success).toBe(false);

    if (result.success) return;

    const mapped = toAppError(result.error);

    expect(mapped.status).toBe(400);
    expect(mapped.code).toBe("VALIDATION_ERROR");
    expect(mapped.details?.[0]?.path).toBe("email");
  });

  it.each([
    ["entity.parse.failed", 400, "MALFORMED_JSON"],
    ["entity.verify.failed", 400, "MALFORMED_JSON"],
    ["charset.unsupported", 400, "MALFORMED_JSON"],
    ["encoding.unsupported", 400, "MALFORMED_JSON"],
    ["stream.encoding.set", 400, "MALFORMED_JSON"],
    ["stream.not.readable", 400, "MALFORMED_JSON"],
    // The client hung up mid-body. Nothing can be delivered; what matters is
    // that it is not counted and alerted on as a server failure.
    ["request.aborted", 400, "MALFORMED_JSON"],
    ["entity.too.large", 413, "PAYLOAD_TOO_LARGE"],
    ["parameters.too.many", 413, "PAYLOAD_TOO_LARGE"],
  ])("maps the body-parser %s error", (type, status, code) => {
    const mapped = toAppError(Object.assign(new Error("bad body"), { type }));

    expect(mapped.status).toBe(status);
    expect(mapped.code).toBe(code);
  });

  it("maps an untranslated Postgres unique violation to 409 CONFLICT", () => {
    // The safety net: a repository that recognises the constraint should raise
    // its own domain error first (ADR-0013).
    const mapped = toAppError(
      Object.assign(
        new Error('duplicate key value violates "staff_email_key"'),
        {
          code: "23505",
        },
      ),
    );

    expect(mapped.status).toBe(409);
    expect(mapped.code).toBe("CONFLICT");
  });

  it("does not name the conflicting constraint", () => {
    // The constraint name would tell a caller which value already exists
    // (ADR-0020 §Enumeration).
    const mapped = toAppError(
      Object.assign(
        new Error('duplicate key value violates "staff_email_key"'),
        {
          code: "23505",
        },
      ),
    );

    expect(mapped.message).toBe("Conflict");
  });

  it("does not echo the body parser's own message", () => {
    // The wire message is ours, so the mapping cannot start leaking library
    // internals if body-parser rewords its errors.
    const mapped = toAppError(
      Object.assign(new Error('unsupported charset "utf-32"'), {
        type: "charset.unsupported",
      }),
    );

    expect(mapped.message).toBe("Unsupported body charset");
  });

  it("leaves no body-parser failure to become a 500", () => {
    // Every one of them is the client's doing. A type that fell through would
    // let an unauthenticated caller drive the server-error rate — and, in
    // development, get a stack trace back for a bad request.
    for (const type of [
      "entity.parse.failed",
      "entity.verify.failed",
      "entity.too.large",
      "parameters.too.many",
      "charset.unsupported",
      "encoding.unsupported",
      "stream.encoding.set",
      "stream.not.readable",
      "request.aborted",
    ]) {
      expect(
        toAppError(Object.assign(new Error("x"), { type })).status,
      ).toBeLessThan(500);
    }
  });

  it("maps anything else to a non-exposed 500", () => {
    const mapped = toAppError(new TypeError("cannot read properties of null"));

    expect(mapped.status).toBe(500);
    expect(mapped.code).toBe("INTERNAL_ERROR");
    expect(mapped.expose).toBe(false);
  });
});

describe("errorHandler", () => {
  it("writes the standard error envelope", () => {
    const { res, body } = handle(notFound("User not found"));

    expect(res.status).toHaveBeenCalledWith(404);
    expect(declaredErrorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      success: false,
      error: { code: "NOT_FOUND", message: "User not found" },
      meta: { requestId },
    });
  });

  it("replaces a non-exposed message with a generic one", () => {
    const { body } = handle(
      internal(new Error("connection string leaked here")),
    );

    expect(JSON.stringify(body)).not.toContain("connection string leaked here");
    expect(body).toMatchObject({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });

  it("sets Retry-After from a retryAfter detail", () => {
    // Load shedding under the argon2 cap throws a 503 from inside a service
    // and has nowhere else to put the hint (ADR-0020 §Hashing cost vs.
    // liveness); a 503 with no `Retry-After` tells a client nothing about
    // whether to come back in a second or in an hour.
    const { res, body } = handle(
      unavailable([{ code: "retryAfter", message: "1" }]),
    );

    expect(res.statusCode).toBe(503);
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "1");
    expect(body).toMatchObject({
      error: { code: "SERVICE_UNAVAILABLE", details: [{ code: "retryAfter" }] },
    });
  });

  it("leaves a Retry-After the rate limiter already set alone", () => {
    // The limiter knows the window; the handler must not overwrite it with a
    // hint meant for a different failure.
    const res = fakeResponse();

    res.setHeader("Retry-After", "900");
    createErrorHandler({
      includeDebug: false,
      logger: createLogger({ level: "silent" }),
    })(
      rateLimited(30),
      {
        ctx: createRequestContext({
          requestId,
          logger: createLogger({ level: "silent" }),
        }),
      } as Request,
      res as unknown as Response,
      vi.fn() as unknown as NextFunction,
    );

    expect(res.headers.get("retry-after")).toBe("900");
  });

  it("sets no Retry-After on an error that carries no hint", () => {
    const { res } = handle(notFound());

    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it("never sends a stack trace outside development", () => {
    const { body } = handle(new Error("boom"), { includeDebug: false });

    expect(JSON.stringify(body)).not.toContain("boom");
    expect(body).not.toHaveProperty("error.debug");
  });

  it("adds error.debug in development only", () => {
    const { body } = handle(new Error("boom"), { includeDebug: true });

    expect(body).toMatchObject({
      error: { debug: { name: "Error", message: "boom" } },
    });
  });

  it("does not add debug to an exposed 4xx, which has nothing to hide", () => {
    const { body } = handle(notFound(), { includeDebug: true });

    expect(body).not.toHaveProperty("error.debug");
  });

  it("omits an empty details array", () => {
    expect(handle(notFound()).body).not.toHaveProperty("error.details");
  });

  it("delegates to Express when the response already started", () => {
    const res = fakeResponse();
    const next = vi.fn();
    const logger = createLogger({ level: "silent" });
    const ctx = createRequestContext({ requestId, logger });

    res.headersSent = true;

    createErrorHandler({ includeDebug: false, logger })(
      new Error("late"),
      { ctx } as Request,
      res as unknown as Response,
      next as unknown as NextFunction,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("logs a 5xx with the error and a 4xx without a stack", () => {
    const logger = createLogger({ level: "silent" });
    const error = vi.spyOn(logger, "error");
    const warn = vi.spyOn(logger, "warn");
    const ctx = createRequestContext({ requestId, logger });
    const handler = createErrorHandler({ includeDebug: false, logger });

    handler(
      internal(new Error("boom")),
      { ctx } as Request,
      fakeResponse() as unknown as Response,
      vi.fn() as unknown as NextFunction,
    );
    handler(
      notFound(),
      { ctx } as Request,
      fakeResponse() as unknown as Response,
      vi.fn() as unknown as NextFunction,
    );

    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]?.[0]).toHaveProperty("err");
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).not.toHaveProperty("err");
  });
});

/**
 * ADR-0066 §3, the delta this record takes on ADR-0013: the handler gains one
 * optional side effect and loses none of its guarantees.
 */
describe("the error-reporting hook", () => {
  it("fires on a 5xx and not on a 4xx", () => {
    const report = vi.fn();

    handle(notFound(), { reporter: { report } });
    expect(report).not.toHaveBeenCalled();

    handle(new Error("boom"), { reporter: { report } });
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]?.[0]).toMatchObject({
      status: 500,
      requestId,
      principal: null,
    });
  });

  it("still renders the response when the reporter throws", () => {
    // `ContainerDeps.reporter` is the injection point a fork uses for a vendor
    // SDK, and `report` is synchronous: an unguarded throw would land before
    // the envelope is written and make the reporter the reason a 500 never
    // renders — the one failure mode ADR-0066 §3 says it must not have.
    const { res, body } = handle(new Error("boom"), {
      reporter: {
        report: () => {
          throw new Error("the reporter exploded");
        },
      },
    });

    expect(res.statusCode).toBe(500);
    expect(declaredErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  });
});
