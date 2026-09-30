import { SignJWT, decodeJwt, decodeProtectedHeader } from "jose";
import { describe, expect, it } from "vitest";

import { isAppError } from "../../../core/errors/index.js";
import { DEFAULT_APP_ID } from "../../../core/http/index.js";
import {
  createAuthorizationRequest,
  createOidcTransactionCodec,
} from "../../../core/oidc/index.js";
import {
  accessKeyId,
  audienceFor,
  createTokenService,
} from "../auth.tokens.js";

/**
 * ADR-0018 §Model: HS256, `aud` per population, `sid` and `roles` claims, and
 * an expiry the caller is told about rather than left to recompute.
 */

const SECRET = "unit-test-signing-key-at-least-32-characters";
const ISSUER = "machxi-api-test";
const APP_ID = "machxi";

const at = (iso: string) => () => new Date(iso);

const service = (now = at("2026-08-18T12:00:00.000Z"), secret = SECRET) =>
  createTokenService({
    secret,
    appId: APP_ID,
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
    expect(audienceFor(APP_ID, "staff")).toBe("machxi-staff");
    expect(audienceFor(APP_ID, "user")).toBe("machxi-user");
    expect(audienceFor(APP_ID, "staff")).not.toBe(audienceFor(APP_ID, "user"));
  });

  /*
   * ADR-0064 §1: the brand is the deployment's `APP_ID`, and the default is
   * what this repository has always signed. Both halves matter — the second
   * is what makes the change reviewable, the first is what makes it a seam.
   */
  it("takes the audience's leading word from APP_ID", () => {
    expect(audienceFor("acme", "staff")).toBe("acme-staff");
    expect(audienceFor("acme", "user")).toBe("acme-user");
    expect(audienceFor(DEFAULT_APP_ID, "staff")).toBe("machxi-staff");
  });

  it("verifies against the audience of the APP_ID that signed it", async () => {
    const acme = createTokenService({
      secret: SECRET,
      appId: "acme",
      issuer: ISSUER,
      accessTtlSec: 900,
      now: at("2026-08-18T12:00:00.000Z"),
    });
    const { token } = await issueStaff(acme);

    expect(decodeJwt(token).aud).toBe("acme-staff");
    // The same secret and the same issuer: only the brand differs, and that is
    // enough for the default deployment to refuse the token.
    await expect(service().verify(token, "staff")).rejects.toMatchObject({
      code: "AUTH_TOKEN_INVALID",
    });
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
      appId: APP_ID,
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

  it("refuses a sign-in transaction signed with the same key (ADR-0072 §2)", async () => {
    // Since ADR-0078 §2 the codec has a key of its own; this case signs one
    // under the access key regardless, to prove the pinned audience,
    // `<APP_ID>-oidc`, still refuses it as a bearer token on its own. The
    // other direction is proved beside the codec.
    const sealed = await createOidcTransactionCodec({
      secret: SECRET,
      appId: APP_ID,
      issuer: ISSUER,
      now: at("2026-08-18T12:00:00.000Z"),
    }).seal({
      ...createAuthorizationRequest(),
      intent: "signin",
      locale: undefined,
    });

    for (const population of ["staff", "user"] as const) {
      const refusal: unknown = await service()
        .verify(sealed, population)
        .catch((error: unknown) => error);

      expect(isAppError(refusal) && refusal.code).toBe("AUTH_TOKEN_INVALID");
    }
  });
});

/*
 * ADR-0078 §2: the access token is signed under a ring of two secrets and
 * names its key, so a leaked secret can be retired without a sign-out.
 */
describe("the key ring", () => {
  const PREVIOUS = "the-secret-a-rotation-moved-out-32-chars";
  const NOW = at("2026-08-18T12:00:00.000Z");

  const ring = (secret = SECRET, previousSecret?: string) =>
    createTokenService({
      secret,
      previousSecret,
      appId: APP_ID,
      issuer: ISSUER,
      accessTtlSec: 900,
      now: NOW,
    });

  /** A token with the claims this API signs, under any key and header. */
  const forge = (key: string, header: { kid?: string }) => {
    const issuedAt = Math.floor(NOW().getTime() / 1000);

    return new SignJWT({
      pop: "staff",
      sid: "22222222-2222-7222-8222-222222222222",
      roles: ["admin"],
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT", ...header })
      .setSubject("11111111-1111-7111-8111-111111111111")
      .setIssuer(ISSUER)
      .setAudience(audienceFor(APP_ID, "staff"))
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 900)
      .sign(new TextEncoder().encode(key));
  };

  it("signs under the current secret and names it", async () => {
    const { token } = await issueStaff(ring(SECRET, PREVIOUS));

    expect(decodeProtectedHeader(token).kid).toBe(accessKeyId(SECRET));
    // The id says which key without saying anything about it.
    expect(accessKeyId(SECRET)).not.toContain(SECRET.slice(0, 8));
    expect(accessKeyId(SECRET)).not.toBe(accessKeyId(PREVIOUS));
  });

  it("a token signed under the previous secret verifies", async () => {
    // Before the rotation: `PREVIOUS` was the current secret.
    const { token } = await issueStaff(ring(PREVIOUS));
    // After it: a new current secret, and the old one kept as previous.
    const rotated = ring(SECRET, PREVIOUS);

    await expect(rotated.verify(token, "staff")).resolves.toMatchObject({
      sid: "22222222-2222-7222-8222-222222222222",
    });

    // And once the previous secret is removed, the token is refused.
    await expect(ring(SECRET).verify(token, "staff")).rejects.toMatchObject({
      code: "AUTH_TOKEN_INVALID",
    });
  });

  it("a token naming an unknown key is refused", async () => {
    // Signed under the current secret, so only the `kid` is wrong: the ring
    // refuses what it cannot name rather than trying every key it holds.
    const token = await forge(SECRET, { kid: "not-a-key-of-ours" });

    const refusal: unknown = await ring(SECRET, PREVIOUS)
      .verify(token, "staff")
      .catch((error: unknown) => error);

    expect(isAppError(refusal) && refusal.code).toBe("AUTH_TOKEN_INVALID");
  });

  it("refuses a token that names one key and is signed under the other", async () => {
    const token = await forge(PREVIOUS, { kid: accessKeyId(SECRET) });

    await expect(
      ring(SECRET, PREVIOUS).verify(token, "staff"),
    ).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });
  });

  it("a token with no key id verifies under the current secret", async () => {
    // What every release before the ring signed: a deployment takes the ring
    // without signing anybody out.
    const legacy = await forge(SECRET, {});

    expect(decodeProtectedHeader(legacy).kid).toBeUndefined();
    await expect(
      ring(SECRET, PREVIOUS).verify(legacy, "staff"),
    ).resolves.toMatchObject({ pop: "staff" });

    // Under the current secret only — never tried against the previous one.
    const underPrevious = await forge(PREVIOUS, {});

    await expect(
      ring(SECRET, PREVIOUS).verify(underPrevious, "staff"),
    ).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });
  });
});
