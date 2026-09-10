import { forgotPasswordBody } from "@repo/contracts";
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
 * ADR-0054 §7's 38px rung and §3's 13/18 control type, as every auth card in
 * this app spells them — this is the same moment in a session's life, in the
 * same card, and a different height would say it is not.
 */
const AUTH_CONTROL = "h-[38px] text-[13px]";
const AUTH_INPUT = `${AUTH_CONTROL} md:text-[13px]`;

/**
 * "Email me a link" (ADR-0071 §4).
 *
 * **`ResendVerificationForm`'s twin, and it is the same screen twice for the
 * same reason.** The endpoint answers `202` for every address — a live
 * account's, a stranger's, a disabled one's, one whose address has never been
 * proven — because ADR-0020 §Enumeration is the whole of its design. So the
 * confirmation is worded about **what was asked** rather than about what was
 * found, and there is deliberately nothing on this screen that a person could
 * read as "yes, that address has an account here".
 *
 * What does get its own sentence is a refusal to *accept* the request: a `429`
 * from either of §4's two budgets is a fact about the caller and the mailbox's
 * traffic, not about the mailbox's contents, and it comes through ADR-0034's
 * code map like every other refusal. The API's own `message` is never rendered
 * — it is a developer-facing English default (ADR-0013).
 *
 * **Hand-wired rather than config-driven**, for the reason every other form on
 * this screen family is: ADR-0035's machinery is built around a record being
 * edited, and asking for a link is not one. What that machinery would have
 * enforced is honoured by hand — every field disabled while the request is in
 * flight, on a `fieldset`, so nothing unregistered escapes.
 *
 * The locale travels in the body because the server must not read a stored one
 * to answer (ADR-0071 §2, §4): looking an account's locale up is a query on
 * exactly one of the two branches, which is a difference an attacker times.
 */
export const ForgotPasswordForm = () => {
  const { t } = useT("auth");
  const client = useApiClient();
  const { locale } = useLocale();
  const messageForError = useMessageForError();

  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFieldError(null);
    setFormError(null);
    setSent(false);

    const parsed = forgotPasswordBody.safeParse({ email, locale });

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
      await client.forgotPassword(parsed.data);
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
            <FieldLabel htmlFor="forgot-email">{t("fields.email")}</FieldLabel>
            <Input
              autoComplete="username"
              className={AUTH_INPUT}
              id="forgot-email"
              name="email"
              onChange={(event) => {
                setEmail(event.target.value);
                /*
                 * The confirmation was about the address that was sent, so it
                 * stops being true the moment the box changes — the resend
                 * control's own correction (`D18.4`), and the person it would
                 * mislead here is the one who mistyped the address they are
                 * trying to recover.
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
              {t("forgot.sent")}
            </p>
          ) : null}

          <Button className={AUTH_CONTROL} type="submit">
            {pending ? t("forgot.submitting") : t("forgot.submit")}
          </Button>
        </FieldGroup>
      </fieldset>
    </form>
  );
};
