import type { RequestContext } from "../context/index.js";
import type { MailMessage, MailSender } from "./mail.types.js";

/**
 * The default transport everywhere but production (ADR-0066 §1).
 *
 * It writes one log line per message and delivers nothing, which is what makes
 * a fresh clone runnable with no mail server: `MAIL_TRANSPORT=log` is the
 * documented local default precisely because a port that must be up to run the
 * API is a worse default than a log line. A developer who wants to *read* the
 * message switches to `smtp` and points it at Mailpit
 * (`docker/local/compose.yaml`).
 *
 * **Recipient and subject, and nothing else.** The body of a credential email
 * is a reset link — a single-use bearer credential — so logging `text` would
 * put it in whatever ships the logs, which is the same argument ADR-0005 makes
 * about redaction and ADR-0057 §2 makes about a token that travels in a URL.
 * The recipient is an email address and is already in the audit trail and in
 * the row the operation touched, so it is what makes the line useful.
 */
export const createLogMailSender = (): MailSender => ({
  send: (ctx: RequestContext, message: MailMessage): Promise<void> => {
    ctx.logger.info(
      { to: message.to, subject: message.subject, transport: "log" },
      "mail not sent (log transport)",
    );

    return Promise.resolve();
  },
});
