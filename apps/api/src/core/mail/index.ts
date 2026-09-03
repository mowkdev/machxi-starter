import type { AppConfig } from "../config/index.js";
import { createLogMailSender } from "./log-mail-sender.js";
import { createSmtpMailSender } from "./smtp-mail-sender.js";
import type { MailSender } from "./mail.types.js";

/**
 * Picks the transport from configuration (ADR-0066 §1).
 *
 * One `switch`-free branch on a two-value enum, and it is the whole of the
 * selection: the adapters are interchangeable behind {@link MailSender}, so
 * every service takes the port and no service knows which one it got.
 *
 * `log` is the default outside production and production must state its
 * choice, so nothing here guesses — an unstated `MAIL_TRANSPORT` in production
 * is a startup failure in the config schema, not a silent `log` that swallows
 * every password reset a deployment ever sends.
 */
export const createMailSender = (config: AppConfig): MailSender =>
  config.mail.transport === "smtp"
    ? createSmtpMailSender({
        host: config.mail.smtp.host,
        port: config.mail.smtp.port,
        secure: config.mail.smtp.secure,
        user: config.mail.smtp.user,
        password: config.mail.smtp.password,
        from: config.mail.from,
      })
    : createLogMailSender();

export { createLogMailSender } from "./log-mail-sender.js";
export {
  createSmtpMailSender,
  type SmtpMailSenderDeps,
} from "./smtp-mail-sender.js";
export type { MailMessage, MailSender, MailTemplate } from "./mail.types.js";
