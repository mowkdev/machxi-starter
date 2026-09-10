import type { MailMessage } from "../../src/core/mail/index.js";
import type { TestApp } from "./app.js";
import { type Tokens } from "./actors.js";

import supertest from "supertest";

/**
 * Reading a mail flow's link back out of the captured messages (ADR-0071 §3).
 *
 * The suite is handed a capturing `MailSender` by `createTestApp`, so what a
 * test reads here is the message the **real** templates rendered, not a stub of
 * one. That matters for the property every one of these flows rests on: the
 * token travels in the URL **fragment** and nowhere else (ADR-0057 §2, as
 * ADR-0071 §1 inherits it), and a helper that parsed a query string would let
 * a regression through unnoticed.
 */

/** `#token=…`, and only from the fragment. */
const FRAGMENT_TOKEN = /#token=([^\s]+)/;

/**
 * The single-use token a message carries.
 *
 * Throws rather than returning `undefined`: a test that reached for a link and
 * found none has already failed, and failing here names the message instead of
 * failing three assertions later on an empty string.
 */
export const tokenFromMail = (message: MailMessage | undefined): string => {
  const match = message?.text.match(FRAGMENT_TOKEN);

  if (match?.[1] === undefined) {
    throw new Error(
      `no "#token=" fragment in the message "${message?.subject ?? "(none sent)"}"`,
    );
  }

  return match[1];
};

/** The last message this app sent to `to`, or `undefined`. */
export const lastMailTo = (
  harness: TestApp,
  to: string,
): MailMessage | undefined =>
  [...harness.mail].reverse().find((message) => message.to === to);

/**
 * Registers an account and walks its verification link, returning the session
 * the link issued (ADR-0071 §3).
 *
 * Setup rather than assertion, like everything in `actors.ts`: the statuses and
 * the envelope of both endpoints are checked in `mail-flows.int.test.ts`, which
 * owns them. What this exists for is every *other* file that used to say "a
 * self-registered account, signed in" in one call and now needs two — the same
 * two a person walks in a browser.
 */
export const registerVerified = async (
  harness: TestApp,
  email: string,
  password: string,
): Promise<{ id: string; email: string; tokens: Tokens }> => {
  await supertest(harness.app)
    .post("/api/v1/public/auth/register")
    .send({ email, password })
    .expect(202);

  const verified = await supertest(harness.app)
    .post("/api/v1/public/auth/verify-email")
    .send({ token: tokenFromMail(lastMailTo(harness, email)) })
    .expect(200);

  return {
    id: verified.body.data.principal.id as string,
    email,
    tokens: {
      accessToken: verified.body.data.accessToken as string,
      refreshToken: verified.body.data.refreshToken as string,
    },
  };
};
