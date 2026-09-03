import type { RequestContext } from "../context/index.js";

/**
 * The mail port (ADR-0066 §1).
 *
 * A seam, not a feature: nothing in this repository sends a message yet, and
 * the flows that will — password reset, address verification, email change,
 * D15's invitations — are their own deliverable. What ships here is the shape
 * they compose against, so that deliverable is about tokens and limiters
 * rather than about which SMTP client somebody reached for.
 */

/**
 * One message.
 *
 * `text` is required and `html` is not, in that order deliberately: a message
 * that renders only as markup is unreadable to a client that refuses it and
 * unreadable in the log adapter, which is the transport a fresh clone runs.
 *
 * There is no `from` — it is the deployment's (`MAIL_FROM`), not the caller's,
 * so no code path can send as an address the deployment did not choose.
 */
export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

/**
 * A rendered message, as a template returns it (ADR-0066 §1).
 *
 * Templates are plain functions returning this shape — no template engine, no
 * MJML, no localization layer. The first flow that needs a second language
 * decides that, and ADR-0046 already says a locale is an account fact rather
 * than a request header.
 */
export type MailTemplate = Omit<MailMessage, "to">;

export interface MailSender {
  /**
   * `ctx` first, like every other dependency a service takes (ADR-0010): the
   * request id on the log line is what ties a delivery to the operation that
   * asked for it.
   */
  readonly send: (ctx: RequestContext, message: MailMessage) => Promise<void>;
}
