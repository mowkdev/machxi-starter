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

import { useAcceptOnboarding } from "./use-accept-onboarding";

/**
 * ADR-0054 §7's 38px login rung and §3's 13/18 control type, as the sign-in
 * card spells them. The same two constants `ResetPasswordForm` uses, and for
 * its reason: both screens are that card with a different field in it.
 */
const AUTH_CONTROL = "h-[38px] text-[13px]";
const AUTH_INPUT = `${AUTH_CONTROL} md:text-[13px]`;

/**
 * "Choose a password" — the operator's half of ADR-0071 §8.
 *
 * `ResetPasswordForm`'s shape and its two states, with the second one saying
 * something different: a dead recovery link has a button beside it, because a
 * customer can ask for another; a dead onboarding link has an instruction,
 * because an operator with no password cannot reach any sender in this app.
 * The control offered is the sign-in page, which is where they will be sent
 * once somebody re-sends the invitation.
 *
 * **Hand-wired rather than config-driven**, for the reason the sign-in form is:
 * ADR-0035's machinery is built around a record being edited, and choosing a
 * password from a mailed link is not one. What that machinery would have
 * enforced is honoured by hand — the field disabled while the request is in
 * flight, on a `fieldset`, so nothing unregistered escapes.
 */
export const OnboardingForm = () => {
  const { t } = useT("auth");
  const { status, pending, formError, fieldError, submit } =
    useAcceptOnboarding();

  const [password, setPassword] = useState("");

  if (status === "refused") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[14px] leading-5 text-muted-foreground">
          {t("onboarding.refused")}
        </p>
        <Link
          className="text-[13px] leading-5 font-medium underline underline-offset-4"
          to="/login"
        >
          {t("forgot.signIn")}
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
            <FieldLabel htmlFor="onboarding-password">
              {t("fields.password")}
            </FieldLabel>
            <Input
              autoComplete="new-password"
              className={AUTH_INPUT}
              id="onboarding-password"
              name="password"
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              type="password"
              value={password}
            />
            {/*
             * The policy's own number, read from the schema rather than
             * written into a sentence (ADR-0023): the rule and the hint
             * cannot disagree, because there is one of them.
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
            {pending ? t("onboarding.submitting") : t("onboarding.submit")}
          </Button>
        </FieldGroup>
      </fieldset>
    </form>
  );
};
