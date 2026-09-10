import type { Locale, Population } from "@repo/contracts";

import type { MailTemplate } from "./mail.types.js";

/**
 * One rendered message per flow (ADR-0071 §2, on ADR-0066 §1's port).
 *
 * Plain functions returning {@link MailTemplate} — no template engine, no
 * MJML, no localization layer — because a message here is four sentences and a
 * link, and the thing worth getting right is the link.
 *
 * **The link is the whole design.** Every one of them carries its token in the
 * URL **fragment** (`#token=…`) and points at an SPA route that strikes the
 * fragment from history before posting the token to the API (ADR-0057 §2, as
 * ADR-0071 §1 inherits it): a fragment is never sent to a server, so no access
 * log, no proxy and no `Referer` header ever sees a single-use credential.
 * Putting one in a path or a query string would undo that silently, which is
 * why `templates.test.ts` asserts the shape of every link this file builds
 * rather than trusting each new one to be written correctly.
 *
 * **English only, with a locale on the seam** (ADR-0071 §2). Every function
 * takes a `Locale` and today every locale resolves to the English copy;
 * adding Latvian is one entry in {@link COPY} and no signature changes, which
 * is what ADR-0066 §1 asked "the first flow that needs a second language" to
 * decide. Where an account exists its stored locale is passed (ADR-0046: a
 * locale is an account fact); where none does — registration, an invitation to
 * a stranger — the SPA's current locale travels in the request body.
 *
 * **Text only.** {@link MailTemplate} allows `html` and nothing here sets it:
 * a message that renders only as markup is unreadable in the log transport a
 * fresh clone runs and in a client that refuses HTML, and the day a deployment
 * wants a designed message is the day it chooses a renderer.
 *
 * **No product name and no durations.** The sender's display name is the
 * deployment's (`MAIL_FROM`), so copy that greeted the reader on behalf of a
 * hard-coded brand would be wrong in every fork; and each TTL is an operator's
 * configuration, so "expires in 24 hours" would become a lie the moment one is
 * changed. The copy says a link expires, and the flow says so again when a
 * refused one lands.
 */

/** The SPA routes each link lands on. Exported so the tests name one thing. */
export const MAIL_LINK_PATHS = {
  verifyEmail: "/verify-email",
  resetPassword: "/reset-password",
  acceptInvitation: "/invitations/accept",
  confirmEmailChange: "/confirm-email",
  staffOnboarding: "/onboarding",
} as const;

/**
 * `origin` + path + `#token=…`.
 *
 * `URLSearchParams` rather than string concatenation, so a token that ever
 * grew a character needing escaping is escaped — and the fragment is read back
 * by the SPA with the same parser (`/impersonate`'s shape, `D13.7`). The
 * origin is a bare origin by the time it reaches here: `originSchema()`
 * refuses a trailing slash or a path at startup.
 */
const linkTo = (origin: string, path: string, token: string): string =>
  `${origin}${path}#${new URLSearchParams({ token }).toString()}`;

/** Every message this repository can send, in one language. */
interface TemplateCopy {
  readonly verifyEmail: (link: string) => MailTemplate;
  readonly passwordReset: (link: string) => MailTemplate;
  readonly organizationInvitation: (input: {
    readonly link: string;
    readonly organizationName: string;
  }) => MailTemplate;
  readonly confirmEmailChange: (input: {
    readonly link: string;
    readonly newEmail: string;
  }) => MailTemplate;
  readonly emailChanged: (input: { readonly newEmail: string }) => MailTemplate;
  readonly staffOnboarding: (link: string) => MailTemplate;
}

/** Written once, at the end of every message that carries a link. */
const IGNORE_IF_UNEXPECTED =
  "If you did not ask for this, you can ignore this message.";

const EXPIRES = "The link can be used once and expires.";

const en: TemplateCopy = {
  verifyEmail: (link) => ({
    subject: "Confirm your email address",
    text: [
      "Confirm this address to finish setting up your account:",
      link,
      // Not "sign in and ask for a new one": ADR-0071 §3 refuses login on a
      // `pending_verification` account with `403 AUTH_EMAIL_UNVERIFIED`, so
      // the affordance is `resend-verification` on the sign-in page and never
      // a session (`D18.2`'s `code-reviewer`).
      `${EXPIRES} If it has expired, ask for a new one from the sign-in page.`,
      IGNORE_IF_UNEXPECTED,
    ].join("\n\n"),
  }),

  passwordReset: (link) => ({
    subject: "Reset your password",
    text: [
      "Choose a new password here:",
      link,
      `${EXPIRES} If it has expired, ask for another from the sign-in page.`,
      // Not "somebody asked to reset your password" — the endpoint answers the
      // same 202 to every address, so this message is the only thing that
      // distinguishes an account that exists, and it goes to the mailbox that
      // owns it (ADR-0020 §Enumeration, ADR-0071 §4).
      "Your password has not changed yet, and every device stays signed in until you choose a new one.",
      IGNORE_IF_UNEXPECTED,
    ].join("\n\n"),
  }),

  organizationInvitation: ({ link, organizationName }) => ({
    subject: `You have been invited to ${organizationName}`,
    text: [
      `You have been invited to join ${organizationName}.`,
      link,
      `${EXPIRES} If it has expired, ask whoever invited you to send another.`,
      IGNORE_IF_UNEXPECTED,
    ].join("\n\n"),
  }),

  confirmEmailChange: ({ link, newEmail }) => ({
    subject: "Confirm your new email address",
    text: [
      `Confirm that ${newEmail} is yours to finish changing the address on your account:`,
      link,
      // The change has not happened yet, and saying so is the point: this
      // message goes to an address that may not belong to the account holder
      // at all (ADR-0071 §6 — nothing changes until the link is followed).
      "Nothing changes until you follow this link, and you keep signing in with your current address until then.",
      `${EXPIRES}`,
      IGNORE_IF_UNEXPECTED,
    ].join("\n\n"),
  }),

  emailChanged: ({ newEmail }) => ({
    subject: "Your email address was changed",
    text: [
      `The email address on your account was changed to ${newEmail}.`,
      // No link, deliberately (ADR-0071 §6): this message is a notice to an
      // address that no longer signs in, and a link in it would be a
      // credential mailed to a mailbox the account no longer belongs to.
      "If you did not do this, contact support straight away — whoever holds the new address can now request a password reset.",
    ].join("\n\n"),
  }),

  staffOnboarding: (link) => ({
    subject: "Set up your account",
    text: [
      "An account has been created for you. Choose a password to finish setting it up:",
      link,
      `${EXPIRES} If it has expired, ask an administrator to send another.`,
      IGNORE_IF_UNEXPECTED,
    ].join("\n\n"),
  }),
};

/**
 * Every locale that has copy of its own, and the fallback that makes the rest
 * legible.
 *
 * `en` is required by the type and the others are optional, so this compiles
 * with one language and keeps compiling with two. A locale with no entry
 * renders English rather than an empty message — the deliberate behaviour of
 * ADR-0071 §2's "English only", and a `templates.test.ts` case asserts it so
 * the fallback is a decision somebody can find rather than a gap.
 */
const COPY: { readonly en: TemplateCopy } & Partial<
  Record<Locale, TemplateCopy>
> = { en };

const copyFor = (locale: Locale): TemplateCopy => COPY[locale] ?? en;

export interface MailTemplatesDeps {
  /** `CUSTOMER_APP_URL` — where every customer-facing link lands. */
  readonly customerUrl: string;
  /** `ADMIN_APP_URL` — the staff onboarding and staff reset links. */
  readonly adminUrl: string;
}

/** What every template takes: the credential, and the reader's language. */
export interface TokenTemplateInput {
  readonly token: string;
  readonly locale: Locale;
}

/**
 * The reset exists on both segments (ADR-0071 §4), so its link is the one that
 * has to know which app the reader signs into.
 */
export interface PasswordResetTemplateInput extends TokenTemplateInput {
  readonly population: Population;
}

export interface InvitationTemplateInput extends TokenTemplateInput {
  readonly organizationName: string;
}

export interface EmailChangeTemplateInput extends TokenTemplateInput {
  readonly newEmail: string;
}

/**
 * Built from the two app origins once, at the composition root, for the reason
 * every other stateful or configured component is: a template that took an
 * origin per call would let one flow mail a link into an origin nobody
 * configured, and a client can never be asked where its own credential should
 * be delivered.
 */
export const createMailTemplates = ({
  customerUrl,
  adminUrl,
}: MailTemplatesDeps) =>
  ({
    verifyEmail: ({ token, locale }: TokenTemplateInput): MailTemplate =>
      copyFor(locale).verifyEmail(
        linkTo(customerUrl, MAIL_LINK_PATHS.verifyEmail, token),
      ),

    passwordReset: ({
      token,
      locale,
      population,
    }: PasswordResetTemplateInput): MailTemplate =>
      copyFor(locale).passwordReset(
        linkTo(
          population === "staff" ? adminUrl : customerUrl,
          MAIL_LINK_PATHS.resetPassword,
          token,
        ),
      ),

    organizationInvitation: ({
      token,
      locale,
      organizationName,
    }: InvitationTemplateInput): MailTemplate =>
      copyFor(locale).organizationInvitation({
        link: linkTo(customerUrl, MAIL_LINK_PATHS.acceptInvitation, token),
        organizationName,
      }),

    confirmEmailChange: ({
      token,
      locale,
      newEmail,
    }: EmailChangeTemplateInput): MailTemplate =>
      copyFor(locale).confirmEmailChange({
        link: linkTo(customerUrl, MAIL_LINK_PATHS.confirmEmailChange, token),
        newEmail,
      }),

    /** The only message here with no token: it is a notice, not a credential. */
    emailChanged: ({
      locale,
      newEmail,
    }: {
      readonly locale: Locale;
      readonly newEmail: string;
    }): MailTemplate => copyFor(locale).emailChanged({ newEmail }),

    staffOnboarding: ({ token, locale }: TokenTemplateInput): MailTemplate =>
      copyFor(locale).staffOnboarding(
        linkTo(adminUrl, MAIL_LINK_PATHS.staffOnboarding, token),
      ),
  }) as const;

export type MailTemplates = ReturnType<typeof createMailTemplates>;
