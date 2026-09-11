import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  createLogger,
  defaultRedactPaths,
  shouldPrettyPrint,
  type CreateLoggerOptions,
} from "../index.js";

interface Capture {
  readonly lines: () => Record<string, unknown>[];
  readonly raw: () => string;
}

const capturing = (
  opts: Omit<CreateLoggerOptions, "destination">,
): [ReturnType<typeof createLogger>, Capture] => {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });

  return [
    createLogger({ ...opts, destination }),
    {
      raw: () => chunks.join(""),
      lines: () =>
        chunks
          .join("")
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line) as Record<string, unknown>),
    },
  ];
};

describe("createLogger", () => {
  it("emits newline-delimited JSON with the level, message and name", () => {
    const [logger, capture] = capturing({ level: "info", name: "api" });

    logger.info({ userId: "u-1" }, "session revoked");

    expect(capture.lines()).toHaveLength(1);
    expect(capture.lines()[0]).toMatchObject({
      level: 30,
      name: "api",
      msg: "session revoked",
      userId: "u-1",
    });
  });

  it("omits the name field when no name is given", () => {
    const [logger, capture] = capturing({ level: "info" });

    logger.info("no name");

    expect(capture.lines()[0]).not.toHaveProperty("name");
  });

  it("suppresses records below the configured level", () => {
    const [logger, capture] = capturing({ level: "info" });

    logger.debug("developer detail");
    logger.warn("worth noticing");

    expect(capture.lines()).toHaveLength(1);
    expect(capture.lines()[0]).toMatchObject({ level: 40 });
  });

  it("emits nothing at level silent", () => {
    const [logger, capture] = capturing({ level: "silent" });

    logger.fatal("boom");

    expect(capture.raw()).toBe("");
  });

  it("binds child fields so records correlate by requestId", () => {
    const [logger, capture] = capturing({ level: "info" });

    logger
      .child({ requestId: "01J0000000000000000000000" })
      .info("request completed");

    expect(capture.lines()[0]).toMatchObject({
      requestId: "01J0000000000000000000000",
      msg: "request completed",
    });
  });

  it("keeps writing NDJSON to an explicit destination even when pretty is set", () => {
    // `destination` wins over `pretty`: pino cannot combine a transport with a
    // passed stream, so the transport is skipped rather than throwing.
    const [logger, capture] = capturing({ level: "info", pretty: true });

    logger.info({ port: 4000 }, "api listening");

    expect(() => capture.lines()).not.toThrow();
    expect(capture.lines()[0]).toMatchObject({
      port: 4000,
      msg: "api listening",
    });
  });

  it("serialises errors under `err` with type, message and stack", () => {
    const [logger, capture] = capturing({ level: "info" });

    logger.error({ err: new TypeError("nope") }, "unexpected failure");

    const err = capture.lines()[0]?.err as Record<string, unknown>;
    expect(err).toMatchObject({ type: "TypeError", message: "nope" });
    expect(err["stack"]).toContain("TypeError: nope");
  });
});

describe("redaction", () => {
  it("redacts credentials at the top level and one level deep", () => {
    const [logger, capture] = capturing({ level: "info" });

    logger.info(
      {
        password: "top-secret",
        accessToken: "at",
        refreshToken: "rt",
        token: "t",
        passwordHash: "$argon2id$…",
        body: { password: "nested-secret", email: "a@b.c" },
        session: { refreshToken: "nested-rt" },
      },
      "credentials",
    );

    const line = capture.lines()[0];
    expect(capture.raw()).not.toContain("top-secret");
    expect(capture.raw()).not.toContain("nested-secret");
    expect(line).toMatchObject({
      password: "[Redacted]",
      accessToken: "[Redacted]",
      refreshToken: "[Redacted]",
      token: "[Redacted]",
      passwordHash: "[Redacted]",
      body: { password: "[Redacted]", email: "a@b.c" },
      session: { refreshToken: "[Redacted]" },
    });
  });

  it("redacts session refresh-token hashes (ADR-0018 columns)", () => {
    // pino matches redact paths by exact key, so "refreshToken" does NOT
    // cover "refreshTokenHash" — these need their own entries. The digest is
    // the lookup key for a live session, so it stays out of logs.
    const [logger, capture] = capturing({ level: "info" });

    logger.info(
      {
        refreshTokenHash: "sha-of-current",
        previousRefreshTokenHash: "sha-of-previous",
        session: {
          id: "01930000-0000-7000-8000-000000000000",
          refreshTokenHash: "nested-sha",
        },
      },
      "session rotated",
    );

    expect(capture.raw()).not.toContain("sha-of-current");
    expect(capture.raw()).not.toContain("sha-of-previous");
    expect(capture.raw()).not.toContain("nested-sha");
    expect(capture.lines()[0]).toMatchObject({
      refreshTokenHash: "[Redacted]",
      previousRefreshTokenHash: "[Redacted]",
      session: {
        id: "01930000-0000-7000-8000-000000000000",
        refreshTokenHash: "[Redacted]",
      },
    });
  });

  it("redacts the `tokenHash` column both handoffs and invitations carry", () => {
    // The same exact-key fact one column further: neither `refreshTokenHash`
    // nor `token` covers `tokenHash`, which is the credential column on
    // `impersonation_handoffs` (ADR-0057 §2) and, since 2026-09-04, on
    // `organization_invitations` (ADR-0067 §2). A service that logged either
    // row wholesale would otherwise print the digest.
    const [logger, capture] = capturing({ level: "info" });

    logger.info(
      {
        tokenHash: "sha-of-handoff",
        invitation: {
          id: "01930000-0000-7000-8000-000000000001",
          tokenHash: "nested-invitation-sha",
        },
      },
      "invitation created",
    );

    expect(capture.raw()).not.toContain("sha-of-handoff");
    expect(capture.raw()).not.toContain("nested-invitation-sha");
    expect(capture.lines()[0]).toMatchObject({
      tokenHash: "[Redacted]",
      invitation: {
        id: "01930000-0000-7000-8000-000000000001",
        tokenHash: "[Redacted]",
      },
    });
  });

  it("redacts the `payload` column and the `newEmail` body field (ADR-0071)", () => {
    // Not credentials, and redacted anyway: `account_tokens.payload` carries
    // the address a change-of-address is about to move to, which the old
    // mailbox has not been told about yet, and `newEmail` is the request
    // body's name for the same value — a controller logging its input would
    // print it under the other spelling.
    const [logger, capture] = capturing({ level: "info" });

    logger.info(
      {
        newEmail: "new@example.test",
        accountToken: {
          id: "01930000-0000-7000-8000-000000000002",
          payload: { newEmail: "nested@example.test" },
        },
      },
      "email change requested",
    );

    expect(capture.raw()).not.toContain("new@example.test");
    expect(capture.raw()).not.toContain("nested@example.test");
    expect(capture.lines()[0]).toMatchObject({ newEmail: "[Redacted]" });
    expect(capture.lines()[0]).toMatchObject({
      newEmail: "[Redacted]",
      accountToken: {
        id: "01930000-0000-7000-8000-000000000002",
        payload: "[Redacted]",
      },
    });
  });

  it("redacts `link`, which is the form a mailed credential travels in", () => {
    // Ahead of its use, the way `tokenHash` was (ADR-0071 §1): the token is
    // not logged as a column, it is logged as the URL that carries it in a
    // fragment, and the `log` mail transport writes a line per message.
    const [logger, capture] = capturing({ level: "info" });

    logger.info(
      { link: "https://app.test/verify-email#token=live-credential" },
      "verification mailed",
    );

    expect(capture.raw()).not.toContain("live-credential");
    expect(capture.lines()[0]).toMatchObject({ link: "[Redacted]" });
  });

  it("redacts the OIDC client secret, the PKCE verifier and the ID token (ADR-0072 §2)", () => {
    // Ahead of their use, like `link` above: the provider port holds all
    // three and logs none, and these paths are what keeps a debugging line —
    // top-level or one object down — from printing them instead.
    const [logger, capture] = capturing({ level: "info" });

    logger.info(
      {
        clientSecret: "google-client-secret",
        codeVerifier: "pkce-verifier-value",
        exchange: { idToken: "eyJhbGciOiJSUzI1NiJ9.signed-assertion" },
      },
      "code exchanged",
    );

    expect(capture.raw()).not.toContain("google-client-secret");
    expect(capture.raw()).not.toContain("pkce-verifier-value");
    expect(capture.raw()).not.toContain("signed-assertion");
    expect(capture.lines()[0]).toMatchObject({
      clientSecret: "[Redacted]",
      codeVerifier: "[Redacted]",
      exchange: { idToken: "[Redacted]" },
    });
  });

  it("leaves `req.url` alone, which is why `url` is not a redact path", () => {
    // The deliberate omission (`D18.1`'s `security-reviewer`): `*.url` would
    // blank the URL on every request log line in the repository, trading the
    // observability of the whole HTTP layer for one hypothetical field name.
    const [logger, capture] = capturing({ level: "info" });

    logger.info({ req: { method: "GET", url: "/api/v1/health" } }, "request");

    expect(capture.lines()[0]).toMatchObject({
      req: { method: "GET", url: "/api/v1/health" },
    });
  });

  it("redacts the authorization and cookie request headers", () => {
    const [logger, capture] = capturing({ level: "info" });

    logger.info(
      {
        req: {
          method: "GET",
          headers: {
            authorization: "Bearer abc.def.ghi",
            cookie: "sid=1",
            host: "localhost:4000",
          },
        },
      },
      "request",
    );

    expect(capture.raw()).not.toContain("abc.def.ghi");
    expect(capture.lines()[0]).toMatchObject({
      req: {
        method: "GET",
        headers: {
          authorization: "[Redacted]",
          cookie: "[Redacted]",
          host: "localhost:4000",
        },
      },
    });
  });

  it("keeps the defaults when extra paths are supplied", () => {
    const [logger, capture] = capturing({
      level: "info",
      redact: ["ssn"],
    });

    logger.info({ ssn: "123-45-6789", password: "p" }, "extra paths");

    expect(capture.lines()[0]).toMatchObject({
      ssn: "[Redacted]",
      password: "[Redacted]",
    });
  });

  it("tolerates an extra path that duplicates a default", () => {
    const [logger, capture] = capturing({
      level: "info",
      redact: ["password"],
    });

    logger.info({ password: "p" }, "duplicate path");

    expect(capture.lines()[0]).toMatchObject({ password: "[Redacted]" });
  });

  it("exports the documented default paths", () => {
    expect(defaultRedactPaths).toContain("req.headers.authorization");
    expect(defaultRedactPaths).toContain("req.headers.cookie");
    expect(defaultRedactPaths).toContain("*.password");
    expect(defaultRedactPaths).toContain("password");
  });
});

describe("shouldPrettyPrint", () => {
  it("is enabled only in development on a TTY", () => {
    expect(shouldPrettyPrint({ nodeEnv: "development", isTty: true })).toBe(
      true,
    );
    expect(shouldPrettyPrint({ nodeEnv: "development", isTty: false })).toBe(
      false,
    );
    expect(shouldPrettyPrint({ nodeEnv: "production", isTty: true })).toBe(
      false,
    );
    expect(shouldPrettyPrint({ nodeEnv: "test", isTty: true })).toBe(false);
  });
});
