import { SignJWT, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";

import {
  OIDC_TRANSACTION_TTL_SEC,
  createAuthorizationRequest,
  createOidcTransactionCodec,
  deriveOidcTransactionSecret,
  oidcTransactionSecret,
} from "../index.js";

/**
 * The transaction cookie's value (ADR-0072 §2): what the start seals and the
 * callback opens, signed under the access tokens' key with an audience of its
 * own.
 *
 * The cases are the ways a value that is not this API's recent transaction
 * could reach the callback — forged, tampered, stale, or a different kind of
 * token signed with the same key — and every one of them must open to
 * nothing, never to a partial transaction.
 */

const SECRET = "test-only-signing-key-for-the-oidc-transaction";
const T0 = new Date("2026-09-11T12:00:00.000Z");

const codec = (now: () => Date = () => T0, secret = SECRET) =>
  createOidcTransactionCodec({
    secret,
    appId: "machxi",
    issuer: "machxi-api",
    now,
  });

const transaction = () => ({
  ...createAuthorizationRequest(),
  intent: "signin" as const,
  locale: "lv" as const,
});

describe("createOidcTransactionCodec", () => {
  it("opens what it sealed, field for field", async () => {
    const sealed = transaction();
    const value = await codec().seal(sealed);

    expect(await codec().open(value)).toEqual(sealed);
  });

  it("opens a link's account and session back, field for field (ADR-0072 §3)", async () => {
    const sealed = {
      ...createAuthorizationRequest(),
      intent: "link" as const,
      userId: "0199a000-0000-7000-8000-000000000001",
      sessionId: "0199a000-0000-7000-8000-000000000002",
      locale: undefined,
    };

    expect(await codec().open(await codec().seal(sealed))).toEqual(sealed);
  });

  it("opens nothing that says it links but names no account or session", async () => {
    // A link transaction without its account would be a link to nobody the
    // callback could name; the schema refuses it rather than guessing.
    const [, payload] = (
      await codec().seal({
        ...createAuthorizationRequest(),
        intent: "link",
        userId: "u",
        sessionId: "s",
        locale: undefined,
      })
    ).split(".");
    const claims = JSON.parse(
      Buffer.from(payload ?? "", "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const { uid: _uid, sid: _sid, ...withoutThem } = claims;
    const reSigned = await new SignJWT(withoutThem)
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .sign(new TextEncoder().encode(SECRET));

    expect(await codec().open(reSigned)).toBeUndefined();
  });

  it("carries an absent locale as absent", async () => {
    const sealed = { ...transaction(), locale: undefined };

    expect(await codec().open(await codec().seal(sealed))).toEqual(sealed);
  });

  it("opens nothing from an absent or empty cookie", async () => {
    expect(await codec().open(undefined)).toBeUndefined();
    expect(await codec().open("")).toBeUndefined();
  });

  it("opens nothing signed under another key", async () => {
    const value = await codec(
      () => T0,
      "a-different-key-entirely-for-this",
    ).seal(transaction());

    expect(await codec().open(value)).toBeUndefined();
  });

  it("opens nothing whose payload was altered", async () => {
    const [header, , signature] = (await codec().seal(transaction())).split(
      ".",
    );
    const forged = Buffer.from(
      JSON.stringify({ st: "mine", nn: "mine", cv: "mine", in: "signin" }),
    ).toString("base64url");

    expect(
      await codec().open(`${header ?? ""}.${forged}.${signature ?? ""}`),
    ).toBeUndefined();
  });

  it("opens nothing past its ten minutes", async () => {
    const value = await codec().seal(transaction());
    const later = new Date(
      T0.getTime() + (OIDC_TRANSACTION_TTL_SEC + 1) * 1000,
    );

    expect(await codec(() => later).open(value)).toBeUndefined();
  });

  it("the codec's key is not the access token's", async () => {
    // ADR-0078 §2: unset, the key is derived from the access secret under a
    // label of its own; stated, it is the codec's own. Either way a value the
    // codec seals does not verify under the access secret, whatever the
    // audience — the separation is the key's, not only the claim's.
    const access = "the-access-token-secret-at-least-32-chars";
    const derived = oidcTransactionSecret({
      transactionSecret: undefined,
      accessSecret: access,
    });

    expect(derived).not.toBe(access);
    // Stable across calls, or a restart would fail every sign-in in flight.
    expect(deriveOidcTransactionSecret(access)).toBe(derived);
    expect(
      oidcTransactionSecret({
        transactionSecret: "the-codecs-own-secret-at-least-32-chars",
        accessSecret: access,
      }),
    ).toBe("the-codecs-own-secret-at-least-32-chars");

    const sealed = await codec(() => T0, derived).seal(transaction());

    await expect(
      jwtVerify(sealed, new TextEncoder().encode(access), {
        currentDate: T0,
      }),
    ).rejects.toMatchObject({ code: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" });
    expect(await codec(() => T0, access).open(sealed)).toBeUndefined();
    expect(await codec(() => T0, derived).open(sealed)).toBeDefined();
  });

  it("opens nothing that is an access token signed with the same key", async () => {
    // Since ADR-0078 §2 the two never share a key in a running API; this
    // case signs one under the codec's key regardless, to prove the audience
    // (`<APP_ID>-user` there, `<APP_ID>-oidc` here) still keeps them apart on
    // its own. The reverse direction is the auth module's to prove.
    const issuedAt = Math.floor(T0.getTime() / 1000);
    const access = await new SignJWT({
      st: "s",
      nn: "n",
      cv: "v",
      in: "signin",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("machxi-api")
      .setAudience("machxi-user")
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 900)
      .sign(new TextEncoder().encode(SECRET));

    expect(await codec().open(access)).toBeUndefined();
  });

  describe("the handoff binding (ADR-0072 §2, amended at `D19.2`)", () => {
    it("binds exactly the token it was sealed for", async () => {
      const binding = await codec().sealHandoff("the-handoff-token", 60);

      expect(await codec().bindsHandoff(binding, "the-handoff-token")).toBe(
        true,
      );
      expect(await codec().bindsHandoff(binding, "a-relayed-token")).toBe(
        false,
      );
      expect(await codec().bindsHandoff(undefined, "the-handoff-token")).toBe(
        false,
      );
    });

    it("lives only as long as the handoff", async () => {
      const binding = await codec().sealHandoff("the-handoff-token", 60);
      const later = new Date(T0.getTime() + 61 * 1000);

      expect(
        await codec(() => later).bindsHandoff(binding, "the-handoff-token"),
      ).toBe(false);
    });

    it("is never taken for a transaction, nor a transaction for it", async () => {
      const binding = await codec().sealHandoff("the-handoff-token", 60);
      const sealed = await codec().seal(transaction());

      expect(await codec().open(binding)).toBeUndefined();
      expect(await codec().bindsHandoff(sealed, "the-handoff-token")).toBe(
        false,
      );
    });
  });
});
