import { MIN_PASSWORD_LENGTH } from "@repo/contracts";
import { useT } from "@repo/i18n";
import { Button } from "@repo/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import {
  useState,
  type ComponentType,
  type FormEvent,
  type ReactNode,
} from "react";

import type { PasswordReset } from "./use-reset-password";

/**
 * ADR-0054 §7's 38px rung and §3's 13/18 control type, as every auth card
 * spells them.
 */
const AUTH_CONTROL = "h-[38px] text-[13px]";
const AUTH_INPUT = `${AUTH_CONTROL} md:text-[13px]`;

/** How the dead link's way forward is drawn; where it goes is the app's. */
const REQUEST_LINK =
  "text-[13px] leading-5 font-medium underline underline-offset-4";

export interface ResetPasswordFormDeps {
  readonly useResetPassword: () => PasswordReset;
  /**
   * The link to the app's `/forgot-password`, as a rendered child (ADR-0077
   * §2): a router's `Link` types `to` against the app's own route tree, so
   * the destination is bound where that tree is.
   */
  readonly RequestLink: ComponentType<{
    readonly className: string;
    readonly children: ReactNode;
  }>;
}

/**
 * "Choose a new password" (ADR-0071 §4) — one form for both apps since
 * `D22.2` (ADR-0077 §2).
 *
 * **Both of the screen's states live here rather than in the page**, and the
 * reason is that the second one is not an error message: a dead link's way
 * forward is to ask for another, so on `refused` the control *is* the link to
 * `/forgot-password` and it belongs where the controls belong — inside the
 * card ADR-0054 §7 draws around them.
 *
 * **The dead-link sentence is the screen's own, not the code map's**, and
 * that is a deliberate departure from the map every other refusal on this
 * screen goes through. `UNAUTHENTICATED` reads "Your session has ended. Sign
 * in again." — true of the fifteen-minute access token it was written for, and
 * false in every word here: the reader is anonymous, no session of theirs has
 * ended, and signing in is precisely what they cannot do. Every *other*
 * refusal — the submit budget's `429` above all — still comes from the map,
 * because those sentences are true wherever they are read.
 *
 * **Hand-wired rather than config-driven**: ADR-0035's machinery is built
 * around a record being edited, and choosing a password from a mailed link is
 * not one. What that machinery would have enforced is honoured by hand — the
 * field disabled while the request is in flight, on a `fieldset`, so nothing
 * unregistered escapes.
 */
export const createResetPasswordForm = ({
  useResetPassword,
  RequestLink,
}: ResetPasswordFormDeps) => {
  const ResetPasswordForm = () => {
    const { t } = useT("accountClient");
    const { status, pending, formError, fieldError, submit } =
      useResetPassword();

    const [password, setPassword] = useState("");

    if (status === "refused") {
      return (
        <div className="flex flex-col gap-4">
          <p className="text-[14px] leading-5 text-muted-foreground">
            {t("recovery.reset.refused")}
          </p>
          <RequestLink className={REQUEST_LINK}>
            {t("recovery.reset.request")}
          </RequestLink>
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
                {t("recovery.fields.newPassword")}
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
               * written into a sentence (ADR-0023): the rule and the hint
               * cannot disagree, because there is one of them.
               */}
              <FieldDescription>
                {t("recovery.reset.passwordHint", {
                  min: MIN_PASSWORD_LENGTH,
                })}
              </FieldDescription>
              {fieldError === null ? null : (
                <FieldError>{fieldError}</FieldError>
              )}
            </Field>

            {formError === null ? null : (
              <FieldError role="alert">{formError}</FieldError>
            )}

            <Button className={AUTH_CONTROL} type="submit">
              {pending
                ? t("recovery.reset.submitting")
                : t("recovery.reset.submit")}
            </Button>
          </FieldGroup>
        </fieldset>
      </form>
    );
  };

  return ResetPasswordForm;
};
