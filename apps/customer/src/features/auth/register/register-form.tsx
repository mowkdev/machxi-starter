import {
  MIN_PASSWORD_LENGTH,
  registerBody,
  type RegisterBody,
} from "@repo/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { useApiClient } from "@/shared/api/context";
import { useLocale, useT } from "@/shared/i18n";
import { useMessageForError } from "@/shared/notifications/messages";
import {
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
} from "@/shared/ui";

import { awaitingVerification } from "../verify-email/awaited-address";

/**
 * ADR-0054 §7's 38px rung and §3's 13/18 control type, exactly as the sign-in
 * card spells them — the two screens are one card in two states, and a
 * register form at a different height would say they are not.
 */
const AUTH_CONTROL = "h-[38px] text-[13px]";
const AUTH_INPUT = `${AUTH_CONTROL} md:text-[13px]`;

/**
 * The registration form (`D15.6`, ADR-0067 §6 — the deferral ADR-0055 §5 left
 * open, closed because sign-up is what creates the personal organization).
 *
 * **The sign-in form's twin in everything but its answer.** Since ADR-0071 §3
 * the response is `202 { accepted: true }` and no session at all: an address
 * nobody has proven is not an account anybody may be signed into, and what
 * signs a device in is the confirmation link. So this form's success path is a
 * navigation to the screen that says so rather than a landing. The refusal is
 * still rendered through ADR-0034's code map and never from the API's own
 * `message`, which is a developer-facing English default (ADR-0013).
 * Hand-wired rather
 * than config-driven for the reason the login form is: ADR-0035's machinery is
 * built around a record being edited, and a sign-up is not one. What that
 * machinery would have enforced is honoured by hand — every field disabled
 * while the request is in flight, on a `fieldset` so nothing unregistered
 * escapes.
 *
 * **The names are optional and are therefore omitted rather than sent empty.**
 * `registerBody` is a `strictObject` whose `firstName`/`lastName` are
 * `nameSchema.optional()` — `min(1)` when present (ADR-0017's nullable
 * columns) — so an untouched box has to leave the body altogether. Sending
 * `""` would be a `VALIDATION_ERROR` for a field the customer never filled in.
 *
 * **Two failures a customer can act on, and they arrive by different roads.**
 * A password below the policy never leaves the browser: `registerBody` is the
 * object the API validates with (ADR-0011/0023), and zod's own messages are
 * localized by the client-side error map (`@repo/form`'s `applyZodLocale`,
 * ADR-0046 §6), so the rule reads in the customer's language without this file
 * writing a sentence. A taken address is the server's to know, and it comes
 * back as the generic `409 CONFLICT` ADR-0020 §Enumeration requires — never a
 * code that would confirm the address has an account.
 */
export interface RegisterFormProps {
  /**
   * An address the sign-up is **fixed to**, or nothing for the ordinary form
   * (`D18.8`, ADR-0071 §5).
   *
   * The invitation screen is its only caller: a stranger who follows an
   * invitation link creates an account with the invited address, because that
   * is the address the offer is addressed to and any other one would produce
   * an account the invitation cannot reach. So the box is filled in and read
   * only rather than absent — a person is entitled to see which mailbox they
   * are signing up with, and a hidden field would make the one fact the screen
   * is about invisible.
   *
   * **`readOnly`, not `disabled`.** A disabled control is skipped by keyboard
   * navigation and is not announced with its value, and this is a fact the
   * reader needs; read only keeps it reachable, selectable and read aloud
   * while refusing the edit.
   *
   * Nothing here is a security boundary and it does not pretend to be one: the
   * API decides who may join what, and it decides by comparing the invited
   * address to the session's own (ADR-0071 §5). What this prevents is a
   * mistake, not an attack.
   */
  readonly email?: string;
}

export const RegisterForm = ({ email: fixedEmail }: RegisterFormProps = {}) => {
  const { t } = useT("auth");
  const client = useApiClient();
  const { locale } = useLocale();
  const messageForError = useMessageForError();
  const navigate = useNavigate();

  const [email, setEmail] = useState(fixedEmail ?? "");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);

    const parsed = registerBody.safeParse({
      email,
      password,
      /*
       * The reader's language, on the one seam where the server cannot know it
       * (ADR-0071 §2, ADR-0046): no account exists yet, so there is no stored
       * locale to write the confirmation message in. The templates ship
       * English today and fall back to it, so this is the parameter arriving
       * before the second dictionary rather than a promise being broken.
       */
      locale,
      // `exactOptionalPropertyTypes` (ADR-0002) makes the spread the honest
      // form: an absent key and an explicitly `undefined` one are different
      // things, and only the first is what "the customer left it blank" means.
      ...(firstName.trim() === "" ? {} : { firstName }),
      ...(lastName.trim() === "" ? {} : { lastName }),
    } satisfies Partial<RegisterBody>);

    if (!parsed.success) {
      setFieldErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            String(issue.path[0] ?? "form"),
            issue.message,
          ]),
        ),
      );
      return;
    }

    setPending(true);

    try {
      await client.register(parsed.data);
      /*
       * **Where a `202` lands** (ADR-0071 §3). Registration starts no session,
       * so `/` was the one place this must not go: the `_dashboard` guard
       * turns an anonymous visitor straight back to the sign-in screen, which
       * tells somebody who has just created an account that they are not
       * signed in and nothing about why. The confirmation screen says what
       * happened and carries the one control that can put it right.
       *
       * The address travels as history state so the resend control starts
       * filled in — see `verify-email/awaited-address.ts` for why it is not a
       * search param.
       *
       * `replace`, so Back cannot return to a sign-up form whose address is
       * now taken: the account exists, and re-submitting it would answer the
       * generic `409` and read as a failure of the thing that just worked.
       */
      await navigate({
        to: "/verify-email",
        replace: true,
        state: awaitingVerification(parsed.data.email),
      });
    } catch (error) {
      setFormError(messageForError(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)}>
      <fieldset aria-busy={pending} disabled={pending}>
        {/* §3's 16px card stack, over `FieldGroup`'s own 28 (ADR-0054 §7). */}
        <FieldGroup className="gap-4">
          <Field data-invalid={Boolean(fieldErrors.email)}>
            <FieldLabel htmlFor="email">{t("fields.email")}</FieldLabel>
            <Input
              autoComplete="username"
              className={AUTH_INPUT}
              id="email"
              name="email"
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              readOnly={fixedEmail !== undefined}
              type="email"
              value={email}
            />
            {fieldErrors.email ? (
              <FieldError>{fieldErrors.email}</FieldError>
            ) : null}
          </Field>

          <Field data-invalid={Boolean(fieldErrors.password)}>
            <FieldLabel htmlFor="password">{t("fields.password")}</FieldLabel>
            <Input
              /*
               * `new-password`, not `current-password`: the browser is being
               * asked to *offer* a password rather than to fill one it already
               * has, which is the whole difference between this screen and the
               * sign-in screen to a password manager.
               */
              autoComplete="new-password"
              className={AUTH_INPUT}
              id="password"
              name="password"
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              type="password"
              value={password}
            />
            {/*
             * The number comes from `@repo/contracts`, not from the sentence:
             * `MIN_PASSWORD_LENGTH` is what `passwordSchema` enforces
             * (ADR-0018's policy v1), so a policy change moves the hint with
             * it instead of leaving two catalogues quietly lying about the
             * rule. The copy is still a key — ADR-0046 §8 — with the value
             * interpolated into it.
             */}
            <FieldDescription>
              {t("register.passwordHint", { min: MIN_PASSWORD_LENGTH })}
            </FieldDescription>
            {fieldErrors.password ? (
              <FieldError>{fieldErrors.password}</FieldError>
            ) : null}
          </Field>

          <Field data-invalid={Boolean(fieldErrors.firstName)}>
            <FieldLabel htmlFor="firstName">{t("fields.firstName")}</FieldLabel>
            <Input
              autoComplete="given-name"
              className={AUTH_INPUT}
              id="firstName"
              name="firstName"
              onChange={(event) => {
                setFirstName(event.target.value);
              }}
              value={firstName}
            />
            {fieldErrors.firstName ? (
              <FieldError>{fieldErrors.firstName}</FieldError>
            ) : null}
          </Field>

          <Field data-invalid={Boolean(fieldErrors.lastName)}>
            <FieldLabel htmlFor="lastName">{t("fields.lastName")}</FieldLabel>
            <Input
              autoComplete="family-name"
              className={AUTH_INPUT}
              id="lastName"
              name="lastName"
              onChange={(event) => {
                setLastName(event.target.value);
              }}
              value={lastName}
            />
            <FieldDescription>{t("register.namesHint")}</FieldDescription>
            {fieldErrors.lastName ? (
              <FieldError>{fieldErrors.lastName}</FieldError>
            ) : null}
          </Field>

          {formError === null ? null : (
            <FieldError role="alert">{formError}</FieldError>
          )}

          <Button className={AUTH_CONTROL} type="submit">
            {pending ? t("register.submitting") : t("register.submit")}
          </Button>
        </FieldGroup>
      </fieldset>
    </form>
  );
};
