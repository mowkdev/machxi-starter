import { expect, type APIRequestContext } from "@playwright/test";

/**
 * Reading the mail, which is the half of every flow in ADR-0071 that only a
 * browser tier can do (`D18.4`; ADR-0071 §Consequences, ADR-0066 §1).
 *
 * **A tier that cannot read the mail cannot prove a single one of these
 * flows.** Every one of them is a single-use token delivered in a link and
 * consumed by a route of the SPA, so a suite with no mailbox can watch a form
 * say "we have sent you a link" and nothing after it. The integration tier
 * reads its links out of the `MailSender` port; this one reads them out of
 * Mailpit, which is the local compose's own mail server and the transport the
 * API is pointed at for the run (`MAIL_TRANSPORT=smtp`).
 *
 * **Mailpit's HTTP API, not its SMTP side.** `GET /api/v1/search` takes the
 * same query language the web interface's box does, and `GET
 * /api/v1/message/{id}` returns the parsed message with its plain-text body —
 * which is the only body these templates ever produce (`core/mail/templates`
 * sets no `html` part), so there is one place a link can be.
 *
 * **The address is the key, and the run's addresses are unique by
 * construction** — every spec that registers builds one from a per-run stamp —
 * so a search by recipient cannot collide with a message left by an earlier
 * run or by a developer's own poking about. Nothing here deletes anything: a
 * failed run's mail is evidence, exactly as its rows are (`organizations.spec`
 * says the same about the account it leaves behind), and a suite that emptied
 * the inbox would be a suite that erases the diagnosis on the way out.
 */

/**
 * Where Mailpit's HTTP API is.
 *
 * `E2E_MAILPIT_URL`, beside `E2E_API_URL` in `turbo.json`'s `test:e2e` env: an
 * address the tier talks to, like the API's, rather than anything the
 * application reads — no app config key is added, which is ADR-0004's step-7
 * rule left untouched. The default is the local compose's published UI port.
 */
export const MAILPIT_URL =
  process.env["E2E_MAILPIT_URL"] ?? "http://localhost:8025";

/** What a search hit carries, of the fields this tier reads. */
interface MailpitSummary {
  readonly ID: string;
  readonly Subject: string;
}

/** What `GET /api/v1/message/{id}` carries, of the same. */
interface MailpitMessage {
  readonly Text: string;
}

/**
 * The most recent message to an address, or `undefined` while none has
 * arrived.
 *
 * Newest first is Mailpit's own order, and it is the order that matters:
 * minting supersedes the live token for the same account and purpose
 * (ADR-0071 §1), so the newest message is the only one whose link still works.
 * A suite that read the oldest would be asserting against a token the API has
 * already consumed on its owner's behalf.
 */
const latestTo = async (
  request: APIRequestContext,
  email: string,
): Promise<MailpitSummary | undefined> => {
  const response = await request.get(`${MAILPIT_URL}/api/v1/search`, {
    // `limit: 1` because only the newest is ever wanted, and because a mailbox
    // that has been left to accumulate should not travel over the wire to
    // answer one question.
    params: { query: `to:${email}`, limit: 1 },
  });

  /*
   * Thrown rather than swallowed, for the reason `assertApiWindowClear` takes
   * such care to separate "throttled" from "absent": a Mailpit that answers
   * badly and an API that never sent the message are different failures, and
   * returning `undefined` for the first would report it twenty seconds later
   * as the second, blaming the wrong process (`D18.4`'s `code-reviewer`).
   */
  if (!response.ok()) {
    throw new Error(
      `Mailpit at ${MAILPIT_URL} answered ${String(response.status())} to a search for ${email}`,
    );
  }

  const body = (await response.json()) as {
    readonly messages?: readonly MailpitSummary[];
  };

  return body.messages?.[0];
};

/**
 * Waits for a message to an address and returns its plain-text body.
 *
 * `expect.poll` rather than a sleep: delivery is a second process's work — the
 * API opens an SMTP connection after answering the request — so the only
 * honest wait is one that asks until it is true, and the only honest failure
 * is Playwright's own timeout with the address in the message.
 */
export const waitForMail = async (
  request: APIRequestContext,
  email: string,
): Promise<string> => {
  let id: string | undefined;

  await expect
    .poll(
      async () => {
        id = (await latestTo(request, email))?.ID;
        return id;
      },
      { message: `no message arrived for ${email}`, timeout: 20_000 },
    )
    .toBeDefined();

  const response = await request.get(`${MAILPIT_URL}/api/v1/message/${id}`);

  expect(response.ok(), `Mailpit refused message ${id}`).toBe(true);

  return ((await response.json()) as MailpitMessage).Text;
};

/**
 * The first link in a message body whose path is the one asked for.
 *
 * **The path is a parameter and the fragment is what comes back.** Every
 * template in ADR-0071 §1 builds `<origin><path>#token=…`, and a message may
 * carry more than one address — the templates' closing sentences do not today,
 * but a template is copy and copy grows — so a helper that took "the first
 * `http`" would start returning the wrong thing silently.
 *
 * Returned whole rather than as a token, because what the tier does with it is
 * *navigate*: the point of these flows is that a person follows a link, and a
 * suite that extracted the token and posted it would be proving the API's
 * behaviour a second time instead of the browser's.
 */
export const linkFromMail = (body: string, path: string): string => {
  /*
   * Bounded to the characters a URL can hold and stopped at whitespace, so the
   * newline the templates put after the link is not swallowed. `path` is a
   * literal from the caller rather than anything a message carried, so there
   * is nothing here for a message to inject into the pattern.
   */
  const found = new RegExp(`https?://[^\\s]*${path}#[^\\s]+`).exec(body);

  expect(found, `no ${path} link in the message`).not.toBeNull();

  return found?.[0] ?? "";
};
