import {
  errorEnvelopeSchema,
  listEnvelopeSchema,
  successEnvelopeSchema,
  type Page,
} from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { errorEnvelope, listEnvelope, successEnvelope } from "../index.js";

/**
 * ADR-0012: one envelope, asserted against the runtime schemas `@repo/contracts`
 * publishes — so a change to the shape breaks here and in every client at the
 * same time, instead of only in the client.
 */

const requestId = "01J0000000000000000000000A";

const resource = { id: "1", email: "a@b.c" };

describe("successEnvelope", () => {
  it("matches the published success schema", () => {
    const envelope = successEnvelope(requestId, resource);

    expect(
      successEnvelopeSchema(z.object({ id: z.string(), email: z.string() })).safeParse(
        envelope,
      ).success,
    ).toBe(true);
    expect(envelope).toEqual({
      success: true,
      data: resource,
      meta: { requestId },
    });
  });

  it("always carries the request id, so any response traces to a log line", () => {
    expect(successEnvelope(requestId, null).meta.requestId).toBe(requestId);
  });
});

describe("listEnvelope", () => {
  const page: Page<{ id: string }> = {
    items: [{ id: "1" }, { id: "2" }],
    total: 143,
    offset: 20,
    limit: 20,
    sort: [{ field: "createdAt", direction: "desc" }],
    filters: { status: "active" },
  };

  it("matches the published list schema", () => {
    expect(
      listEnvelopeSchema(z.object({ id: z.string() })).safeParse(
        listEnvelope(requestId, page),
      ).success,
    ).toBe(true);
  });

  it("echoes the resolved pagination, sort and filters", () => {
    const { meta } = listEnvelope(requestId, page);

    expect(meta.pagination).toEqual({ offset: 20, limit: 20, total: 143 });
    expect(meta.sort).toEqual([{ field: "createdAt", direction: "desc" }]);
    expect(meta.filters).toEqual({ status: "active" });
  });

  it("omits `filters` when nothing was filtered, so its presence means something", () => {
    const meta = listEnvelope(requestId, { ...page, filters: {} }).meta;

    expect("filters" in meta).toBe(false);
  });

  it("carries a null total for an endpoint that opts out of count(*)", () => {
    expect(
      listEnvelope(requestId, { ...page, total: null }).meta.pagination.total,
    ).toBeNull();
  });
});

describe("errorEnvelope", () => {
  it("matches the published error schema", () => {
    const envelope = errorEnvelope(requestId, {
      code: "NOT_FOUND",
      message: "User not found",
    });

    expect(errorEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(envelope.success).toBe(false);
  });

  it("is discriminated by `success`, never by the presence of `data`", () => {
    const failure = errorEnvelope(requestId, {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });

    expect("data" in failure).toBe(false);
  });
});
