import { describe, expect, it } from "vitest";

import {
  MAIL_LINK_PATHS,
  createMailTemplates,
  type MailTemplate,
  type MailTemplates,
} from "../index.js";

/**
 * Every message, and the one property they all share (ADR-0071 §1, §2).
 *
 * The property is where the token sits: **after the `#`, and nowhere else**. A
 * fragment is never sent to a server, so a link in a fragment is a credential
 * that no access log, proxy or `Referer` header can capture; the same token in
 * a path or a query string is the same credential written into every log
 * between the reader and this API. It is one keystroke apart from correct and
 * nothing else in the system would notice, which is why it is asserted over
 * the whole roster rather than per template.
 *
 * {@link RENDERED} is typed as a total record of {@link MailTemplates}, so a
 * seventh message does not compile until it is listed here and covered by
 * everything below.
 */

const CUSTOMER = "https://app.example.com";
const ADMIN = "https://admin.example.com";
/** Base64url, like a real one: nothing here needs percent-encoding. */
const TOKEN = "Zm9vYmFy-_9xyz";

const templates = createMailTemplates({
  customerUrl: CUSTOMER,
  adminUrl: ADMIN,
});

const RENDERED: Record<keyof MailTemplates, MailTemplate> = {
  verifyEmail: templates.verifyEmail({ token: TOKEN, locale: "en" }),
  passwordReset: templates.passwordReset({
    token: TOKEN,
    locale: "en",
    population: "user",
  }),
  organizationInvitation: templates.organizationInvitation({
    token: TOKEN,
    locale: "en",
    organizationName: "Acme Ltd",
  }),
  confirmEmailChange: templates.confirmEmailChange({
    token: TOKEN,
    locale: "en",
    newEmail: "new@machxi.local",
  }),
  emailChanged: templates.emailChanged({
    locale: "en",
    newEmail: "new@machxi.local",
  }),
  staffOnboarding: templates.staffOnboarding({ token: TOKEN, locale: "en" }),
};

/** The one message that carries no credential, so it carries no link either. */
const WITHOUT_LINK = ["emailChanged"] as const;

const urlsIn = (message: MailTemplate): string[] =>
  message.text.match(/https?:\/\/\S+/g) ?? [];

const entries = Object.entries(RENDERED) as [
  keyof MailTemplates,
  MailTemplate,
][];

describe.each(entries)("%s", (name, message) => {
  it("is a readable message with a subject", () => {
    expect(message.subject.length).toBeGreaterThan(0);
    expect(message.text.length).toBeGreaterThan(0);
    // No `html`, deliberately: the log transport a fresh clone runs and a
    // client that refuses markup must both be able to read it (ADR-0066 §1).
    expect(message.html).toBeUndefined();
  });

  it("carries the token after the # and never in the path or the query", () => {
    const urls = urlsIn(message);

    if ((WITHOUT_LINK as readonly string[]).includes(name)) {
      // A notice sent to an address that no longer signs in. A link here would
      // be a credential mailed to a mailbox the account no longer belongs to
      // (ADR-0071 §6).
      expect(urls).toEqual([]);

      return;
    }

    expect(urls).toHaveLength(1);

    const url = new URL(urls[0] ?? "");

    expect(url.hash).toBe(`#token=${TOKEN}`);
    expect(url.search).toBe("");
    expect(`${url.origin}${url.pathname}`).not.toContain(TOKEN);
  });
});

describe("where each link lands", () => {
  const pathOf = (message: MailTemplate): string =>
    new URL(urlsIn(message)[0] ?? "").pathname;

  const originOf = (message: MailTemplate): string =>
    new URL(urlsIn(message)[0] ?? "").origin;

  it("points the customer flows at the customer app", () => {
    expect(originOf(RENDERED.verifyEmail)).toBe(CUSTOMER);
    expect(originOf(RENDERED.organizationInvitation)).toBe(CUSTOMER);
    expect(originOf(RENDERED.confirmEmailChange)).toBe(CUSTOMER);

    expect(pathOf(RENDERED.verifyEmail)).toBe(MAIL_LINK_PATHS.verifyEmail);
    expect(pathOf(RENDERED.organizationInvitation)).toBe(
      MAIL_LINK_PATHS.acceptInvitation,
    );
    expect(pathOf(RENDERED.confirmEmailChange)).toBe(
      MAIL_LINK_PATHS.confirmEmailChange,
    );
  });

  it("points staff onboarding at the admin app", () => {
    // The onboarding link hands whoever opens it a password on an operator
    // account, so it must never be built out of the customer origin
    // (ADR-0071 §8).
    expect(originOf(RENDERED.staffOnboarding)).toBe(ADMIN);
    expect(pathOf(RENDERED.staffOnboarding)).toBe(
      MAIL_LINK_PATHS.staffOnboarding,
    );
  });

  it("sends the reset to the app the reader signs into", () => {
    // One flow, two populations (ADR-0071 §4): the same template, and the
    // origin is the only thing that differs.
    const staff = templates.passwordReset({
      token: TOKEN,
      locale: "en",
      population: "staff",
    });

    expect(originOf(RENDERED.passwordReset)).toBe(CUSTOMER);
    expect(originOf(staff)).toBe(ADMIN);
    expect(pathOf(staff)).toBe(MAIL_LINK_PATHS.resetPassword);
  });
});

describe("the locale seam", () => {
  it("renders English for a locale that has no copy yet", () => {
    // ADR-0071 §2: every template takes a locale and ships English only, so
    // Latvian is one entry in the copy table and no signature change. The
    // fallback is a decision, not a gap — a missing dictionary must not send
    // somebody an empty message.
    expect(templates.verifyEmail({ token: TOKEN, locale: "lv" })).toEqual(
      RENDERED.verifyEmail,
    );
  });
});

describe("what each message says", () => {
  it("names the organization in an invitation", () => {
    expect(RENDERED.organizationInvitation.subject).toContain("Acme Ltd");
  });

  it("tells the old address where its account went", () => {
    // The notice is what a person whose session was stolen sees first, so it
    // names the new address and what the holder of it can now do (ADR-0071 §6).
    expect(RENDERED.emailChanged.text).toContain("new@machxi.local");
    expect(RENDERED.emailChanged.text).toContain("support");
  });

  it("says the change has not happened yet on the confirmation", () => {
    // It is sent to an address that may not be the account holder's at all.
    expect(RENDERED.confirmEmailChange.text).toContain("Nothing changes");
  });
});
