import type { Locale } from "@repo/contracts";

import type { RequestContext } from "../context/index.js";
import type { MailSender, MailTemplate } from "./mail.types.js";

/**
 * Sending a message from a service, and the two rules every sender obeys
 * (ADR-0066 §1, ADR-0071 §3–§4).
 *
 * Built here rather than privately in each module for the reason the port
 * itself is here: the rules below are properties of *sending mail in this API*
 * and not of any one flow, and a module that wrote its own would be re-deciding
 * them — which is how the second sender ends up logging an SMTP rejection with
 * the recipient in it. `D18.7` extracted it when the invitation became the
 * third flow that sends; before that it lived in the auth service, unchanged.
 */

/**
 * The language a message is written in, where the request may not have said
 * (ADR-0071 §2, ADR-0046).
 *
 * The anonymous flows carry the SPA's current locale in the body and may omit
 * it; every template ships English today and falls back to it for a locale it
 * has no copy for, so this only has to turn "unstated" into the one language
 * that always exists.
 */
export const localeFor = (locale: Locale | undefined): Locale => locale ?? "en";

/**
 * What a failed delivery may be logged as (ADR-0005, ADR-0020 §Enumeration).
 *
 * The class and the transport's own `code` — `EENVELOPE`, `ECONNECTION`,
 * `EAUTH` — and never the message: an SMTP rejection quotes the recipient it
 * refused, and the flows that call this are the ones that must not say which
 * addresses exist. `core/audit`'s `describeFailure` makes the same trade for
 * the same reason on a driver error that carries the row it failed to write.
 */
const describeTransportFailure = (
  error: unknown,
): { readonly error: string; readonly code?: string } => {
  if (!(error instanceof Error)) return { error: typeof error };

  const { code } = error as Error & { code?: unknown };

  return {
    error: error.name,
    ...(typeof code === "string" ? { code } : {}),
  };
};

export interface MailDeliveryDeps {
  /** ADR-0066 §1's port. Never a mail client a service imports. */
  readonly mail: MailSender;
}

/**
 * Fields put on the failure line beside the transport's own description.
 *
 * Strings only, and never an address: the caller says which *flow* failed —
 * `{ purpose: "verify_email", population: "user" }` — and nothing that
 * identifies who it was going to.
 */
export type MailLogFields = Readonly<Record<string, string>>;

export const createMailDelivery = ({ mail }: MailDeliveryDeps) => {
  /**
   * Sends a message and **never fails the request** (ADR-0066 §1, ADR-0071
   * §3).
   *
   * Every caller has already committed: the account exists, or the token row
   * does, or the invitation does. Rethrowing would answer `500` for work that
   * succeeded and, on registration, leave the caller permanently stuck — the
   * retry meets the `409` their own first attempt created. The remedy is
   * `resend-verification`, which is a button rather than a support ticket.
   *
   * It also has to be silent for the endpoints that answer `202` whatever they
   * find (§3, §4): an error that escaped only when an account existed would be
   * the account-existence oracle those endpoints are shaped to avoid.
   *
   * The failure is logged at `error` with the caller's fields and no address,
   * so a deployment whose transport is broken is visible in the logs rather
   * than in a user's silence.
   *
   * **The driver's message is deliberately not on the line** (`D18.3`'s
   * `security-reviewer`). A relay rejects a recipient by quoting the envelope
   * — `550 5.1.1 <someone@example.com> User unknown` — so logging
   * `error.message` from an endpoint whose whole shape is "reveal nothing"
   * would write the probed addresses into the logs anyway. The error's class
   * and its `code` say which transport failed and how, which is what an
   * operator acts on; the request id reaches the rest.
   */
  const deliver = async (
    ctx: RequestContext,
    to: string,
    fields: MailLogFields,
    template: MailTemplate,
  ): Promise<void> => {
    try {
      await mail.send(ctx, { to, ...template });
    } catch (error: unknown) {
      ctx.logger.error(
        { ...fields, ...describeTransportFailure(error) },
        "mail delivery failed",
      );
    }
  };

  /**
   * The same send, deliberately **not awaited** (ADR-0071 §3–§4, amended at
   * `D18.5` on that step's `security-reviewer`).
   *
   * The endpoints that answer the same thing whatever they find must not
   * differ between their branches in anything a caller can observe, and *time*
   * is something a caller can observe: awaiting an SMTP round trip on the
   * branch where an account exists, against a single indexed `SELECT` on the
   * branch where none does, is an account-existence oracle measured in the
   * tens or hundreds of milliseconds — larger than the difference ADR-0018
   * §Login goes to the trouble of erasing with `dummyHash()`, and reachable
   * three times an hour per address, which is all a timing attack needs
   * against a difference that size.
   *
   * `void` rather than a queue: {@link deliver} already swallows every failure
   * and logs it, so this promise cannot reject and there is nothing to await
   * for correctness. What it costs is a message lost if the process dies in
   * the window between the response and the relay accepting it — invisible to
   * the caller either way, because the answer never promised delivery, and
   * recoverable by asking again.
   *
   * The **residual** is the mint, which stays on the response path because the
   * link cannot be built without it: one short transaction against a primary
   * key, on the order of a millisecond against a sub-millisecond miss. It is
   * written down in ADR-0071 §4 rather than claimed away, the posture
   * ADR-0018 §Login takes with its own.
   *
   * A sender with no oracle to erase takes it anyway — the invitation's, for
   * instance (ADR-0071 §5): the answer reports the invitation and never the
   * delivery, so awaiting a relay would only make the inviter wait for a
   * result they are not given.
   */
  const deliverDetached = (
    ctx: RequestContext,
    to: string,
    fields: MailLogFields,
    template: MailTemplate,
  ): void => {
    void deliver(ctx, to, fields, template);
  };

  return { deliver, deliverDetached } as const;
};

export type MailDelivery = ReturnType<typeof createMailDelivery>;
