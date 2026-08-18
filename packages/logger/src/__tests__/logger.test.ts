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
