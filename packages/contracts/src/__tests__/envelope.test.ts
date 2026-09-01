import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ERROR_CODES,
  declaredErrorEnvelopeSchema,
  errorEnvelopeSchema,
  isErrorEnvelope,
  isSuccessEnvelope,
  listEnvelopeSchema,
  successEnvelopeSchema,
  type Envelope,
  type ErrorEnvelope,
  type ListEnvelope,
  type SuccessEnvelope,
} from "../index.js";

const resource = z.object({ id: z.uuid(), email: z.email() });

const anEnvelope = {
  success: true,
  data: { id: "0199a1f4-4c2e-7c53-9c62-3e0f9d0f7f11", email: "anna@acme.com" },
  meta: { requestId: "01J8Z4V2N7" },
} satisfies SuccessEnvelope<{ id: string; email: string }>;

const anError = {
  success: false,
  error: {
    code: "VALIDATION_ERROR",
    message: "Request validation failed",
    details: [
      { path: "email", message: "Invalid email", code: "invalid_format" },
    ],
  },
  meta: { requestId: "01J8Z4V2N7" },
} satisfies ErrorEnvelope;

describe("envelope guards", () => {
  it("discriminates on success (ADR-0012)", () => {
    const success: Envelope<unknown> = anEnvelope;
    const failure: Envelope<unknown> = anError;

    expect(isSuccessEnvelope(success)).toBe(true);
    expect(isErrorEnvelope(success)).toBe(false);
    expect(isSuccessEnvelope(failure)).toBe(false);
    expect(isErrorEnvelope(failure)).toBe(true);
  });

  it("narrows so that data and error are never both reachable", () => {
    const envelope: Envelope<{ id: string; email: string }> = anEnvelope;

    if (isErrorEnvelope(envelope)) {
      expect.unreachable("the fixture is a success envelope");
    } else {
      expect(envelope.data).toBeDefined();
    }
  });
});

describe("successEnvelopeSchema", () => {
  it("accepts a well-formed single-resource response", () => {
    expect(successEnvelopeSchema(resource).safeParse(anEnvelope).success).toBe(
      true,
    );
  });

  it("requires success: true and a requestId in meta", () => {
    const schema = successEnvelopeSchema(resource);

    expect(schema.safeParse({ ...anEnvelope, success: false }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...anEnvelope, meta: {} }).success).toBe(false);
  });

  it("rejects a payload that is not the declared resource", () => {
    expect(
      successEnvelopeSchema(resource).safeParse({
        ...anEnvelope,
        data: { id: "nope" },
      }).success,
    ).toBe(false);
  });

  it("tolerates fields it does not know, so adding one stays additive (ADR-0015)", () => {
    const result = successEnvelopeSchema(resource).safeParse({
      ...anEnvelope,
      meta: { requestId: "01J8Z4V2N7", locale: "en" },
    });

    expect(result.success).toBe(true);
  });
});

describe("listEnvelopeSchema", () => {
  const listed = {
    success: true,
    data: [anEnvelope.data],
    meta: {
      requestId: "01J8Z4V2N7",
      pagination: { offset: 0, limit: 20, total: 143 },
      sort: [{ field: "createdAt", direction: "desc" }],
      filters: { status: "active" },
    },
  } satisfies ListEnvelope<{ id: string; email: string }>;

  it("accepts a well-formed list response", () => {
    expect(listEnvelopeSchema(resource).safeParse(listed).success).toBe(true);
  });

  it("insists on pagination, which a list envelope always carries", () => {
    const withoutPagination = {
      ...listed,
      meta: { requestId: listed.meta.requestId },
    };

    expect(
      listEnvelopeSchema(resource).safeParse(withoutPagination).success,
    ).toBe(false);
  });

  it("allows a null total for the endpoints that may skip the count (ADR-0014)", () => {
    const meta = {
      ...listed.meta,
      pagination: { offset: 0, limit: 20, total: null },
    };

    expect(
      listEnvelopeSchema(resource).safeParse({ ...listed, meta }).success,
    ).toBe(true);
  });

  it("rejects a sort direction outside asc/desc", () => {
    const meta = {
      ...listed.meta,
      sort: [{ field: "createdAt", direction: "sideways" }],
    };

    expect(
      listEnvelopeSchema(resource).safeParse({ ...listed, meta }).success,
    ).toBe(false);
  });
});

describe("errorEnvelopeSchema", () => {
  it("accepts a well-formed error response", () => {
    expect(errorEnvelopeSchema.safeParse(anError).success).toBe(true);
  });

  it("accepts every declared error code", () => {
    for (const code of ERROR_CODES) {
      expect(
        errorEnvelopeSchema.safeParse({
          ...anError,
          error: { code, message: "x" },
        }).success,
      ).toBe(true);
    }
  });

  it("accepts a code this build has never heard of", () => {
    /*
     * The widening of `D13.1`. It read `and nothing else` until then, and a
     * closed enum here is a client that stops recognising the envelope the
     * moment the API adds a code — which ADR-0015 says is additive and
     * `errors.ts` tells clients to survive by degrading on the HTTP status.
     * Rejecting the parse instead threw the status away with the rest of it.
     */
    expect(
      errorEnvelopeSchema.safeParse({
        ...anError,
        error: { code: "TEAPOT", message: "x" },
      }).success,
    ).toBe(true);
  });

  it("keeps a producer-side schema that refuses an undeclared code", () => {
    /*
     * The half the widening must not cost. `apps/api`'s conformance tests
     * assert with the declared pair, so "the API emits only ADR-0013's codes"
     * stays a runtime claim about the bytes and not only a claim about
     * `AppError`'s type.
     */
    const unknown = { ...anError, error: { code: "TEAPOT", message: "x" } };

    expect(declaredErrorEnvelopeSchema.safeParse(unknown).success).toBe(false);
    expect(declaredErrorEnvelopeSchema.safeParse(anError).success).toBe(true);

    for (const code of ERROR_CODES) {
      expect(
        declaredErrorEnvelopeSchema.safeParse({
          ...anError,
          error: { code, message: "x" },
        }).success,
      ).toBe(true);
    }
  });

  it("still requires a code", () => {
    // Wide is not absent: `code` is what a client branches on, and an error
    // object without one is not this envelope.
    for (const error of [{ message: "x" }, { code: "", message: "x" }]) {
      expect(errorEnvelopeSchema.safeParse({ ...anError, error }).success).toBe(
        false,
      );
    }
  });

  it("requires success: false", () => {
    expect(
      errorEnvelopeSchema.safeParse({ ...anError, success: true }).success,
    ).toBe(false);
  });

  it("accepts the development-only debug block", () => {
    const result = errorEnvelopeSchema.safeParse({
      ...anError,
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        debug: { name: "TypeError", message: "boom", stack: "…" },
      },
    });

    expect(result.success).toBe(true);
  });
});
