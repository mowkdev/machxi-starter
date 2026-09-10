import { MIN_PASSWORD_LENGTH } from "@repo/contracts";
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { useT } from "@/shared/i18n";
import {
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
} from "@/shared/ui";

import { useResetPassword } from "./use-reset-password";

/**
 * ADR-0054 §7's 38px rung and §3's 13/18 control type, as every auth card in
 * this app spells them.
 */
const AUTH_CONTROL = "h-[38px] text-[13px]";
const AUTH_INPUT = `${AUTH_CONTROL} md:text-[13px]`;

/**
 * "Choose a new password" (ADR-0071 §4).
 *
 * **Both of the screen's states live here rather than in the page**, and the
 * reason is that the second one is not an error message: a dead link's way
 * forward is to ask for another, so on `refused` the control *is* the link to
 * `/forgot-password` and it belongs where the controls belong — inside the
 * card ADR-0054 §7 draws around them. The confirmation screen made the same
 * call one step earlier, putting its resend form in the card and only the
 * secondary "go to sign in" underneath.
 *
 * **The dead-link sentence is the screen's own, not the catalogue's**, and that
 * is a deliberate departure from the code map every other refusal on these
 * screens goes through. `UNAUTHENTICATED` reads "Your session has ended. Sign
 * in again." — true of the fifteen-minute access token it was written for, and
 * false in every word here: the person is anonymous, no session of theirs has
 * ended, and signing in is precisely what they cannot do. `/verify-email`
 * renders `verify.refused` for the identical `401` and for the identical
 * reason. Every *other* refusal — the submit budget's `429` above all — still
 * comes from the catalogue, because those sentences are true wherever they are
 * read.
 *
 * **Hand-wired rather than config-driven**, for the reason its neighbours are:
 * ADR-0035's machinery is built around a record being edited, and choosing a
 * password from a mailed link is not one. What that machinery would have
 * enforced is honoured by hand — the field disabled while the request is in
 * flight, on a `fieldset`, so nothing unregistered escapes.
 */
export const ResetPasswordForm = () => {
  const { t } = useT("auth");
  const { status, pending, formError, fieldError, submit } = useResetPassword();

  const [password, setPassword] = useState("");

  if (status === "refused") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[14px] leading-5 text-muted-foreground">
          {t("reset.refused")}
        </p>
        <Link
          className="text-[13px] leading-5 font-medium underline underline-offset-4"
          to="/forgot-password"
        >
          {t("reset.request")}
        </Link>
      </div>
    );
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit(password);
  };

  return (
    <form noValidate onSubmit={onSubmit}>
      <fieldset aria-busy={pending} disabled={pending}>
        {/* §3's 16px card stack, over `FieldGroup`'s own 28 (ADR-0054 §7). */}
        <FieldGroup className="gap-4">
          <Field data-invalid={Boolean(fieldError)}>
            <FieldLabel htmlFor="new-password">
              {t("fields.newPassword")}
            </FieldLabel>
            <Input
              autoComplete="new-password"
              className={AUTH_INPUT}
              id="new-password"
              name="newPassword"
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              type="password"
              value={password}
            />
            {/*
             * The policy's own number, read from the schema rather than
             * written into a sentence (ADR-0023): the rule and the hint cannot
             * disagree, because there is one of them.
             */}
            <FieldDescription>
              {t("reset.passwordHint", { min: MIN_PASSWORD_LENGTH })}
            </FieldDescription>
            {fieldError === null ? null : <FieldError>{fieldError}</FieldError>}
          </Field>

          {formError === null ? null : (
            <FieldError role="alert">{formError}</FieldError>
          )}

          <Button className={AUTH_CONTROL} type="submit">
            {pending ? t("reset.submitting") : t("reset.submit")}
          </Button>
        </FieldGroup>
      </fieldset>
    </form>
  );
};
