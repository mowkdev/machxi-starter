import { createTransport, type Transporter } from "nodemailer";

import type { RequestContext } from "../context/index.js";
import { internal } from "../errors/index.js";
import type { MailMessage, MailSender } from "./mail.types.js";

/**
 * The SMTP transport (ADR-0066 §1).
 *
 * A `create*` factory around nodemailer's constructor, per ADR-0009: the
 * library is held in a closure and nothing above this file knows it exists, so
 * replacing it is one file rather than a search.
 *
 * Chosen **only** by `MAIL_TRANSPORT=smtp`. Locally that is Mailpit
 * (`docker/local/compose.yaml`, port 1025, no credentials), where a developer
 * reads the message in a browser; in production it is whatever the deployment
 * runs, and `NODE_ENV=production` refuses an unstated transport so the choice
 * is never a default nobody made.
 */

export interface SmtpMailSenderDeps {
  readonly host: string;
  readonly port: number;
  /** Implicit TLS (port 465). `false` still upgrades opportunistically via STARTTLS. */
  readonly secure: boolean;
  /** Absent for a local relay such as Mailpit, which authenticates nobody. */
  readonly user?: string | undefined;
  readonly password?: string | undefined;
  /** The envelope sender, from `MAIL_FROM`: a deployment's fact, never a caller's. */
  readonly from: string;
}

export const createSmtpMailSender = ({
  host,
  port,
  secure,
  user,
  password,
  from,
}: SmtpMailSenderDeps): MailSender => {
  // Built once, at composition time, for the reason the rate limiters are
  // (ADR-0009): a transporter holds a connection pool, and one per call would
  // open a TCP connection per message.
  const transporter: Transporter = createTransport({
    host,
    port,
    secure,
    // Omitted entirely rather than passed as `{ user: undefined }`: nodemailer
    // treats the presence of `auth` as "authenticate", and a relay that wants
    // no credentials would then be sent an empty AUTH.
    ...(user === undefined || password === undefined
      ? {}
      : { auth: { user, pass: password } }),
  });

  return {
    send: async (ctx: RequestContext, message: MailMessage): Promise<void> => {
      try {
        await transporter.sendMail({
          from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.html === undefined ? {} : { html: message.html }),
        });
      } catch (error) {
        // The driver's error goes to the log with its stack and `cause`; the
        // client gets `internal()`, which is not exposed (ADR-0013), because
        // an SMTP rejection line can name the relay, the credential it refused
        // and the recipient's existence.
        ctx.logger.error(
          { err: error, to: message.to, subject: message.subject },
          "mail delivery failed",
        );

        throw internal(error);
      }

      ctx.logger.info(
        { to: message.to, subject: message.subject, transport: "smtp" },
        "mail sent",
      );
    },
  };
};
