import { resendVerificationBody } from "@repo/contracts";
import { useState, type FormEvent } from "react";

import { useApiClient } from "@/shared/api/context";
import { useLocale, useT } from "@/shared/i18n";
import { useMessageForError } from "@/shared/notifications/messages";
import {
  Button,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
} from "@/shared/ui";

/**
 * ADR-0054 §7's 38px rung and §3's 13/18 control type, as both auth cards
 * spell them — this control sits in the same card at the same moment in a
 * session's life, and a different height would say it does not.
 */
const AUTH_CONTROL = "h-[38px] text-[13px]";
const AUTH_INPUT = `${AUTH_CONTROL} md:text-[13px]`;

export interface ResendVerificationFormProps {
  /**
   * The address to start with — the sign-up form's, or the one the sign-in
   * form was refused for. Empty for a cold arrival at `/verify-email`.
   */
  readonly email: string;
}

/**
 * "Send me the link again" (ADR-0071 §3).
 *
 * **The address is a field rather than a fact, and that is what makes the
 * screen work at all.** The endpoint answers `202` for every address, known or
 * not, so there is nothing to protect by hiding the box — and a person who
 * mistyped their address at sign-up has no other way out of the state they are
 * in. A screen that could only resend to an address it was handed would strand
 * exactly the person the control exists for.
 *
 * **One sentence for every outcome that is not a refusal to *accept* the
 * request.** ADR-0020 §Enumeration is the whole of the endpoint's design: an
 * address with an account waiting and a stranger's must be indistinguishable,
 * so the confirmation is worded about what was asked rather than about what
 * was found. What does get its own sentence is a `429` — the limiter refused
 * to take the request at all (ADR-0071 §4's budget, shared between this
 * endpoint and recovery in a counter of its own), which is a fact about the
 * caller and not about the mailbox.
 *
 * **Hand-wired rather than config-driven**, for the reason its two neighbours
 * are: ADR-0035's machinery is built around a record being edited, and asking
 * for a link is not one. What that machinery would have enforced is honoured
 * by hand — the field disabled while the request is in flight, on a
 * `fieldset`, so nothing unregistered escapes.
 *
 * The locale travels in the body because the server has no account to read one
 * off (ADR-0071 §2): the answer must not depend on whether the address has one.
 */
export const ResendVerificationForm = ({
  email: initialEmail,
}: ResendVerificationFormProps) => {
  const { t } = useT("auth");
  const client = useApiClient();
  const { locale } = useLocale();
  const messageForError = useMessageForError();

  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFieldError(null);
    setFormError(null);
    setSent(false);

    const parsed = resendVerificationBody.safeParse({ email, locale });

    if (!parsed.success) {
      /*
       * One field, so one message — the first issue rather than a map keyed by
       * path. The sentence is zod's own, localized by the client-side error map
       * (`@repo/form`'s `applyZodLocale`, ADR-0046 §6), so the rule reads in the
       * reader's language without this file writing one.
       */
      setFieldError(parsed.error.issues[0]?.message ?? null);
      return;
    }

    setPending(true);

    try {
      await client.resendVerification(parsed.data);
      setSent(true);
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
          <Field data-invalid={Boolean(fieldError)}>
            <FieldLabel htmlFor="resend-email">{t("fields.email")}</FieldLabel>
            <Input
              autoComplete="username"
              className={AUTH_INPUT}
              id="resend-email"
              name="email"
              onChange={(event) => {
                setEmail(event.target.value);
                /*
                 * The confirmation was about the address that was sent, so it
                 * stops being true the moment the box changes — and the person
                 * it would mislead is exactly the one this control exists for:
                 * somebody correcting a typo they made at sign-up (`D18.4`'s
                 * `code-reviewer`).
                 */
                setSent(false);
              }}
              type="email"
              value={email}
            />
            {fieldError === null ? null : <FieldError>{fieldError}</FieldError>}
          </Field>

          {formError === null ? null : (
            <FieldError role="alert">{formError}</FieldError>
          )}

          {/*
           * `role="status"`, not `role="alert"`: nothing went wrong, and a
           * screen reader should hear this when it gets to it rather than have
           * it interrupt whatever is being read.
           */}
          {sent ? (
            <p
              className="text-[13px] leading-5 text-muted-foreground"
              role="status"
            >
              {t("verify.resend.sent")}
            </p>
          ) : null}

          <Button className={AUTH_CONTROL} type="submit">
            {pending
              ? t("verify.resend.submitting")
              : t("verify.resend.submit")}
          </Button>
        </FieldGroup>
      </fieldset>
    </form>
  );
};
