import { describe, expect, it } from "vitest";

import { fail, listOk, ok } from "../testing/envelope";

/**
 * The response builders every MSW handler in both SPAs goes through
 * (`D20.10`, ADR-0062 §1, ADR-0036 §The load-bearing rule).
 *
 * They had no test in either app, which was survivable while each app owned
 * its own copy and its own screens exercised it. Shared, it is one file
 * standing behind two suites: a `meta` member dropped here would make several
 * hundred assertions certify an API that does not exist, and every one of them
 * would stay green. So what the envelope *is* — ADR-0012's three shapes — is
 * asserted directly, by reading the body back.
 */

const REQUEST_ID = "00000000-0000-7000-8000-000000000000";

const bodyOf = async (response: Response): Promise<unknown> =>
  (await response.json()) as unknown;

describe("ok", () => {
  it("wraps the payload in ADR-0012's success envelope", async () => {
    const response = ok({ id: "1" });

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({
      success: true,
      data: { id: "1" },
      meta: { requestId: REQUEST_ID },
    });
  });

  it("takes the status a created resource answers with", () => {
    expect(ok({ id: "1" }, 201).status).toBe(201);
  });
});

describe("listOk", () => {
  it("fills all three meta members `respond.list` fills (ADR-0012, ADR-0014)", async () => {
    const response = listOk({
      items: [{ id: "1" }],
      total: 7,
      offset: 20,
      limit: 10,
      sort: [{ field: "createdAt", direction: "desc" }],
      filters: { status: { eq: "active" } },
    });

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({
      success: true,
      data: [{ id: "1" }],
      meta: {
        requestId: REQUEST_ID,
        // The three the client reads back rather than recomputing. A builder
        // that emitted only `pagination` would describe an API the frontend
        // wishes it had, which is the exact dishonesty ADR-0036's rule closes.
        pagination: { offset: 20, limit: 10, total: 7 },
        sort: [{ field: "createdAt", direction: "desc" }],
        filters: { status: { eq: "active" } },
      },
    });
  });

  it("takes a status, the way `ok` does", () => {
    // No handler passes one today. The parameter came across with the file and
    // is kept rather than trimmed, because this step moves the harness without
    // changing it and the two builders are meant to have one signature; a
    // parameter nothing exercises is how a signature quietly stops working.
    expect(
      listOk(
        { items: [], total: 0, offset: 0, limit: 20, sort: [], filters: {} },
        206,
      ).status,
    ).toBe(206);
  });

  it("carries the uncounted page ADR-0060 §2 types (`total: null`)", async () => {
    const response = listOk({
      items: [],
      total: null,
      offset: 0,
      limit: 20,
      sort: [],
      filters: {},
    });

    expect(await bodyOf(response)).toMatchObject({
      meta: { pagination: { total: null } },
    });
  });
});

describe("fail", () => {
  it("answers ADR-0013's error envelope at the given status", async () => {
    const response = fail(403, "FORBIDDEN", "Not your organization");

    expect(response.status).toBe(403);
    expect(await bodyOf(response)).toEqual({
      success: false,
      error: { code: "FORBIDDEN", message: "Not your organization" },
      meta: { requestId: REQUEST_ID },
    });
  });

  it("falls back to the code as the message", async () => {
    expect(await bodyOf(fail(429, "RATE_LIMITED"))).toMatchObject({
      error: { code: "RATE_LIMITED", message: "RATE_LIMITED" },
    });
  });

  it("sends no `details` key when the caller gives none", async () => {
    // What this catches is a `details: details ?? []`, which would put an empty
    // array on the wire where the API sends nothing. It does *not* catch an
    // unconditional `details: details`: `HttpResponse.json` serialises through
    // `JSON.stringify`, which drops an undefined-valued key, so the two are the
    // same body. Absent-versus-explicitly-undefined is `exactOptionalPropertyTypes`
    // (ADR-0002) at compile time, not an assertion anything can make here.
    expect(await bodyOf(fail(404, "NOT_FOUND"))).not.toHaveProperty(
      "error.details",
    );
  });

  it("carries the field paths a form test applies to its inputs (ADR-0013)", async () => {
    const response = fail(422, "VALIDATION_ERROR", "Invalid", [
      { path: "email", message: "Already taken" },
    ]);

    expect(await bodyOf(response)).toMatchObject({
      error: { details: [{ path: "email", message: "Already taken" }] },
    });
  });
});
