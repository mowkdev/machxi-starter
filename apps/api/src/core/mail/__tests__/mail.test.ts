import { createLogger } from "@repo/logger";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../../config/index.js";
import { createRequestContext } from "../../context/index.js";
import { createLogMailSender, createMailSender } from "../index.js";

/**
 * ADR-0066 §1: a mail port with two adapters, chosen by configuration.
 *
 * Nothing in this repository sends a message yet, so what is worth testing is
 * exactly the seam: which adapter a given `MAIL_TRANSPORT` produces, and that
 * the default one records who the message was for without recording what it
 * said.
 */

const sendMail =
  vi.fn<(options: Record<string, unknown>) => Promise<unknown>>();
const createTransport = vi.fn((_options: Record<string, unknown>) => ({
  sendMail,
}));

vi.mock("nodemailer", () => ({
  createTransport: (options: Record<string, unknown>) =>
    createTransport(options),
}));

const baseEnv = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://machxi:machxi@localhost:5432/machxi",
  JWT_ACCESS_SECRET: "a".repeat(32),
} as const;

const configWith = (overrides: Record<string, string> = {}) =>
  loadConfig({ ...baseEnv, ...overrides });

const context = () => {
  const ctx = createRequestContext({
    requestId: "01J0000000000000000000000A",
    logger: createLogger({ level: "silent" }),
  });

  return { ctx, info: vi.spyOn(ctx.logger, "info") };
};

beforeEach(() => {
  sendMail.mockReset();
  sendMail.mockResolvedValue({});
  createTransport.mockClear();
});

describe("createMailSender", () => {
  it("builds the log transport when MAIL_TRANSPORT is unset", async () => {
    const { ctx, info } = context();

    await createMailSender(configWith()).send(ctx, {
      to: "person@example.com",
      subject: "Reset your password",
      text: "https://app.example.com/reset#token=secret",
    });

    // The decision, not an implementation detail: nodemailer is never even
    // constructed, which is what makes a fresh clone runnable with no server.
    expect(createTransport).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "person@example.com",
        subject: "Reset your password",
        transport: "log",
      }),
      expect.any(String),
    );
  });

  it("builds the SMTP transport only for MAIL_TRANSPORT=smtp", async () => {
    const { ctx } = context();

    await createMailSender(
      configWith({
        MAIL_TRANSPORT: "smtp",
        SMTP_HOST: "mailpit",
        SMTP_PORT: "1025",
        MAIL_FROM: "no-reply@example.com",
      }),
    ).send(ctx, {
      to: "person@example.com",
      subject: "Reset your password",
      text: "body",
    });

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "mailpit", port: 1025, secure: false }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "no-reply@example.com",
        to: "person@example.com",
        subject: "Reset your password",
        text: "body",
      }),
    );
  });

  it("omits `auth` entirely when no credentials are configured", async () => {
    const { ctx } = context();

    await createMailSender(
      configWith({ MAIL_TRANSPORT: "smtp", SMTP_HOST: "mailpit" }),
    ).send(ctx, { to: "a@example.com", subject: "s", text: "t" });

    // Not `{ auth: undefined }`: nodemailer reads the *presence* of the key as
    // "authenticate", and Mailpit authenticates nobody.
    expect(createTransport.mock.calls[0]?.[0]).not.toHaveProperty("auth");
  });

  it("is chosen by transport alone — SMTP settings do not select SMTP", async () => {
    const { ctx } = context();

    await createMailSender(
      configWith({ SMTP_HOST: "mailpit", SMTP_USER: "u", SMTP_PASSWORD: "p" }),
    ).send(ctx, { to: "a@example.com", subject: "s", text: "t" });

    expect(createTransport).not.toHaveBeenCalled();
  });
});

describe("createLogMailSender", () => {
  it("records the recipient and the subject and never the body", async () => {
    const { ctx, info } = context();

    await createLogMailSender().send(ctx, {
      to: "person@example.com",
      subject: "Reset your password",
      text: "https://app.example.com/reset#token=single-use-credential",
      html: "<a>same credential</a>",
    });

    const [fields] = info.mock.calls[0] ?? [];

    // The body of a credential email *is* a credential (ADR-0057 §2). A log
    // line that carries it puts it wherever the logs go.
    expect(fields).not.toHaveProperty("text");
    expect(fields).not.toHaveProperty("html");
    expect(JSON.stringify(fields)).not.toContain("single-use-credential");
  });
});
