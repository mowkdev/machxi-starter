import { decodeJwt, decodeProtectedHeader } from "jose";
import { describe, expect, it } from "vitest";

import { isAppError } from "../../../core/errors/index.js";
import { audienceFor, createTokenService } from "../auth.tokens.js";

/**
 * ADR-0018 §Model: HS256, `aud` per population, `sid` and `roles` claims, and
 * an expiry the caller is told about rather than left to recompute.
 */

const SECRET = "unit-test-signing-key-at-least-32-characters";
const ISSUER = "machxi-api-test";

const at = (iso: string) => () => new Date(iso);

const service = (now = at("2026-08-18T12:00:00.000Z"), secret = SECRET) =>
  createTokenService({
    secret,
    issuer: ISSUER,
    accessTtlSec: 900,
    now,
  });

const issueStaff = (tokens: ReturnType<typeof service>) =>
  tokens.issue({
    principalId: "11111111-1111-7111-8111-111111111111",
    population: "staff",
    sessionId: "22222222-2222-7222-8222-222222222222",
    roles: ["admin"],
  });

describe("createTokenService", () => {
  it("signs HS256 and carries the ADR-0018 claim set", async () => {
    const { token, expiresAt } = await issueStaff(service());

    expect(decodeProtectedHeader(token).alg).toBe("HS256");

    const claims = decodeJwt(token);

    expect(claims).toMatchObject({
      sub: "11111111-1111-7111-8111-111111111111",
      pop: "staff",
      sid: "22222222-2222-7222-8222-222222222222",
      roles: ["admin"],
      iss: ISSUER,
      aud: "machxi-staff",
    });
    // `jti` exists so a future denylist or audit log can name one token rather
    // than one session.
    expect(typeof claims.jti).toBe("string");
    expect(expiresAt.toISOString()).toBe("2026-08-18T12:15:00.000Z");
  });

  it("reports the same expiry it put in the token", async () => {
    // A client that trusts `accessTokenExpiresAt` must not be able to disagree
    // with the server about when the token dies.
    const { token, expiresAt } = await issueStaff(service());

    expect(decodeJwt(token).exp).toBe(Math.floor(expiresAt.getTime() / 1000));
  });

  it("gives each population its own audience", () => {
    expect(audienceFor("staff")).toBe("machxi-staff");
    expect(audienceFor("user")).toBe("machxi-user");
    expect(audienceFor("staff")).not.toBe(audienceFor("user"));
  });

  it("verifies a token it issued", async () => {
    const tokens = service();
    const { token } = await issueStaff(tokens);
    const claims = await tokens.verify(token, "staff");

    expect(claims.sub).toBe("11111111-1111-7111-8111-111111111111");
    expect(claims.sid).toBe("22222222-2222-7222-8222-222222222222");
    expect(claims.roles).toEqual(["admin"]);
    expect(claims.pop).toBe("staff");
  });

  it("refuses a staff token on the user segment", async () => {
    // The `aud` claim is the second line of defence behind the router guard:
    // even a misconfigured mount cannot let a token cross populations.
    const tokens = service();
    const { token } = await issueStaff(tokens);

    await expect(tokens.verify(token, "user")).rejects.toMatchObject({
      code: "AUTH_TOKEN_INVALID",
      status: 401,
    });
  });

  it("distinguishes expiry from every other failure", async () => {
    // The codes differ because the client's reaction differs: refresh, or log
    // in again (ADR-0013).
    const issuer = service(at("2026-08-18T12:00:00.000Z"));
    const { token } = await issueStaff(issuer);

    const later = service(at("2026-08-18T12:15:01.000Z"));

    await expect(later.verify(token, "staff")).rejects.toMatchObject({
      code: "AUTH_TOKEN_EXPIRED",
    });
  });

  it("accepts a token that is one second from expiry", async () => {
    const issuer = service(at("2026-08-18T12:00:00.000Z"));
    const { token } = await issueStaff(issuer);
    const later = service(at("2026-08-18T12:14:59.000Z"));

    await expect(later.verify(token, "staff")).resolves.toMatchObject({
      pop: "staff",
    });
  });

  it("refuses a token signed with a different key", async () => {
    const { token } = await issueStaff(service());
    const other = service(
      at("2026-08-18T12:00:00.000Z"),
      "a-completely-different-signing-key-32-chars",
    );

    await expect(other.verify(token, "staff")).rejects.toMatchObject({
      code: "AUTH_TOKEN_INVALID",
    });
  });

  it("refuses a token from another issuer", async () => {
    const foreign = createTokenService({
      secret: SECRET,
      issuer: "someone-elses-api",
      accessTtlSec: 900,
    });
    const { token } = await issueStaff(foreign);

    await expect(service().verify(token, "staff")).rejects.toMatchObject({
      code: "AUTH_TOKEN_INVALID",
    });
  });

  it.each(["", "not-a-jwt", "a.b.c"])(
    "refuses the malformed token %j as an AppError, not a jose error",
    async (token) => {
      // Everything this module throws has to be an AppError, or the error
      // middleware renders it as a 500 (ADR-0013).
      const error = await service()
        .verify(token, "staff")
        .catch((thrown: unknown) => thrown);

      expect(isAppError(error)).toBe(true);
    },
  );

  it("drops a role the population no longer has, rather than refusing the token", async () => {
    // A role can only disappear by being removed from the enum, which is a
    // deploy. Refusing would log every affected user out; dropping it can only
    // reduce what the bearer may do.
    const tokens = service();
    const { token } = await tokens.issue({
      principalId: "11111111-1111-7111-8111-111111111111",
      population: "staff",
      sessionId: "22222222-2222-7222-8222-222222222222",
      // `customer` is a *user* role and can never be held by staff.
      roles: ["admin", "customer"],
    });

    await expect(tokens.verify(token, "staff")).resolves.toMatchObject({
      roles: ["admin"],
    });
  });
});
