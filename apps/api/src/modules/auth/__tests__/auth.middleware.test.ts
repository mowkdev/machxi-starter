import { createLogger } from "@repo/logger";
import express from "express";
import supertest from "supertest";
import { describe, expect, it } from "vitest";

import { createContextMiddleware } from "../../../core/middleware/context.js";
import { createErrorHandler } from "../../../core/middleware/error-handler.js";
import { createHttpLogger } from "../../../core/middleware/http-logger.js";
import type { SessionRecord, SessionsRepository } from "../auth.repository.js";
import { createAuthenticate, readBearerToken } from "../auth.middleware.js";
import { createTokenService } from "../auth.tokens.js";

/**
 * ADR-0018 §Authenticated request: verify the token, then confirm the session
 * behind it is still alive — which is what makes logout and admin revocation
 * take effect immediately rather than at the next token expiry.
 */

const SECRET = "unit-test-signing-key-at-least-32-characters";
const PRINCIPAL_ID = "11111111-1111-7111-8111-111111111111";
const SESSION_ID = "22222222-2222-7222-8222-222222222222";

const now = () => new Date("2026-08-18T12:00:00.000Z");

const tokens = createTokenService({
  secret: SECRET,
  issuer: "machxi-api-test",
  accessTtlSec: 900,
  now,
});

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: SESSION_ID,
  principalType: "staff",
  principalId: PRINCIPAL_ID,
  refreshTokenHash: "hash",
  previousRefreshTokenHash: null,
  refreshTokenExpiresAt: new Date("2026-09-18T12:00:00.000Z"),
  rotatedAt: null,
  revokedAt: null,
  ...overrides,
});

const sessionsReturning = (
  row: SessionRecord | undefined,
): SessionsRepository =>
  ({
    findById: () => Promise.resolve(row),
  }) as unknown as SessionsRepository;

/** An app whose only route reports what the guard put on the context. */
const probeApp = (sessions: SessionsRepository) => {
  const logger = createLogger({ level: "silent" });
  const app = express();
  const authenticate = createAuthenticate({ tokens, sessions, now });

  app.use(createHttpLogger(logger));
  app.use(createContextMiddleware());
  app.get("/probe", authenticate("staff"), (req, res) => {
    res.status(200).json({ principal: req.ctx.principal });
  });
  app.use(createErrorHandler({ includeDebug: false, logger }));

  return app;
};

const staffToken = () =>
  tokens
    .issue({
      principalId: PRINCIPAL_ID,
      population: "staff",
      sessionId: SESSION_ID,
      roles: ["admin"],
    })
    .then(({ token }) => token);

describe("readBearerToken", () => {
  it("returns the token from a well-formed header", () => {
    expect(readBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("is case-insensitive on the scheme, as RFC 7235 requires", () => {
    expect(readBearerToken("bearer abc")).toBe("abc");
    expect(readBearerToken("BEARER abc")).toBe("abc");
  });

  it("reports an absent header separately from a wrong one", () => {
    // `null` means nobody presented credentials — `UNAUTHENTICATED`.
    // `undefined` means somebody presented the wrong thing —
    // `AUTH_TOKEN_INVALID` (ADR-0013).
    expect(readBearerToken(undefined)).toBeNull();
    expect(readBearerToken("   ")).toBeNull();
    expect(readBearerToken("Basic dXNlcjpwYXNz")).toBeUndefined();
    expect(readBearerToken("Bearer")).toBeUndefined();
    expect(readBearerToken("Bearer   ")).toBeUndefined();
  });
});

describe("authenticate", () => {
  it("sets the principal from the verified claims", async () => {
    const response = await supertest(probeApp(sessionsReturning(session())))
      .get("/probe")
      .set("Authorization", `Bearer ${await staffToken()}`)
      .expect(200);

    expect(response.body.principal).toEqual({
      kind: "staff",
      id: PRINCIPAL_ID,
      roles: ["admin"],
      sessionId: SESSION_ID,
    });
  });

  it("answers UNAUTHENTICATED when no credentials are presented", async () => {
    const response = await supertest(probeApp(sessionsReturning(session())))
      .get("/probe")
      .expect(401);

    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("answers AUTH_TOKEN_INVALID for a non-bearer scheme", async () => {
    const response = await supertest(probeApp(sessionsReturning(session())))
      .get("/probe")
      .set("Authorization", "Basic dXNlcjpwYXNz")
      .expect(401);

    expect(response.body.error.code).toBe("AUTH_TOKEN_INVALID");
  });

  it("refuses a token whose session was revoked", async () => {
    // The whole reason the guard pays for a database read.
    const response = await supertest(
      probeApp(sessionsReturning(session({ revokedAt: new Date() }))),
    )
      .get("/probe")
      .set("Authorization", `Bearer ${await staffToken()}`)
      .expect(401);

    expect(response.body.error.code).toBe("AUTH_SESSION_REVOKED");
  });

  it("refuses a token whose session has expired", async () => {
    const response = await supertest(
      probeApp(
        sessionsReturning(
          session({ refreshTokenExpiresAt: new Date("2026-08-18T11:59:59Z") }),
        ),
      ),
    )
      .get("/probe")
      .set("Authorization", `Bearer ${await staffToken()}`)
      .expect(401);

    expect(response.body.error.code).toBe("AUTH_SESSION_REVOKED");
  });

  it("refuses a token whose session vanished", async () => {
    const response = await supertest(probeApp(sessionsReturning(undefined)))
      .get("/probe")
      .set("Authorization", `Bearer ${await staffToken()}`)
      .expect(401);

    expect(response.body.error.code).toBe("AUTH_SESSION_REVOKED");
  });

  it("refuses a session that belongs to a different principal", async () => {
    // Not producible by a client — the signature covers both claims — so it
    // means a session id was reused across rows.
    const response = await supertest(
      probeApp(sessionsReturning(session({ principalId: "someone-else" }))),
    )
      .get("/probe")
      .set("Authorization", `Bearer ${await staffToken()}`)
      .expect(401);

    expect(response.body.error.code).toBe("AUTH_TOKEN_INVALID");
  });

  it("refuses a session recorded against the other population", async () => {
    const response = await supertest(
      probeApp(sessionsReturning(session({ principalType: "user" }))),
    )
      .get("/probe")
      .set("Authorization", `Bearer ${await staffToken()}`)
      .expect(401);

    expect(response.body.error.code).toBe("AUTH_TOKEN_INVALID");
  });
});
