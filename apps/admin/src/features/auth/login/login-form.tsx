import { loginBody } from "@repo/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { useApiClient } from "@/shared/api/context";
import { useT } from "@/shared/i18n";
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
 * §7's 38px login rung and §3's 13/18 control type, spelled on the call site.
 *
 * Two constants rather than one because the two primitives re-raise the size
 * differently: `Button`'s base is a plain `text-sm`, which `text-[13px]`
 * displaces outright, while `Input` ships `text-base md:text-sm` and takes its
 * own size back from 768px up — so the field, and only the field, needs the
 * `md:` twin. `@repo/grid`'s search box spells it the same way, for the same
 * reason.
 *
 * **What this step does not do is close §3's gap.** The record surfaces' fields
 * are still on `Input`'s own type (`D11.5` spelled their heights and paddings
 * and left the size), so after this step the login is the only form in the app
 * on §3's control rung. Applying it everywhere is an app-wide sweep and not
 * this screen's to make; ADR-0054 §7 records it rather than leaving the next
 * reader to find the two disagreeing by eye.
 */
const LOGIN_CONTROL = "h-[38px] text-[13px]";
const LOGIN_INPUT = `${LOGIN_CONTROL} md:text-[13px]`;

/**
 * The login form (ADR-0033 §Boot is the other half of this).
 *
 * A feature, because ADR-0032 gives features the interactions that *change*
 * something. It validates with `loginBody` from `@repo/contracts` — the same
 * object the API validates with (ADR-0011/0023), so client and server cannot
 * disagree about what a password must be.
 *
 * The form is hand-wired rather than config-driven: ADR-0035's `AppFormInput`
 * and its registries are `D3.6`, and building the first form on machinery that
 * does not exist would invert the order the plan sets. What it does honour is
 * the rule that machinery exists to enforce — **every field is disabled while
 * the request is in flight**, on a `fieldset` so nothing unregistered escapes.
 * `D3.5` turns `pending` into a real mutation's `isPending`; the behaviour is
 * the same either way, which is why it is written as behaviour now.
 *
 * **Its controls are 38px since `D11.7`** (ADR-0054 §7): the one rung above
 * the 36px every other form input in the app takes, spelled here because the
 * login is the one screen the reference sizes up. It is reached through `cn`
 * on the generated primitives rather than by editing them, which is ADR-0047's
 * rule and the same route §7's dialog width took at `D11.5`.
 */
export const LoginForm = () => {
  const { t } = useT("auth");
  const client = useApiClient();
  const messageForError = useMessageForError();
  const navigate = useNavigate();
  const { redirect } = useSearch({ from: "/_auth/login" });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);

    const parsed = loginBody.safeParse({ email, password });

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
      // The client hydrates the store; this feature only decides where to go
      // next. `redirect` is the location `_dashboard`'s guard turned away,
      // already fenced to a same-origin path by the route's `validateSearch`.
      await client.login(parsed.data);
      await navigate({ to: redirect ?? "/" });
    } catch (error) {
      /*
       * ADR-0034's code-to-message map, which is where every code gets a
       * sentence written for an operator — including `SERVICE_UNAVAILABLE`,
       * which is what a dropped socket becomes on the way out of the ADR-0033
       * client.
       *
       * It replaces an earlier version that rendered the API's own `message`.
       * That message is a developer-facing English default (ADR-0013) and is
       * deliberately not shown: showing it bypasses the i18n seam `messages.ts`
       * exists to be, and puts wording nobody wrote for this screen on it. The
       * line said `D3.5` would replace it and D3.5 replaced it everywhere else;
       * this was the last one, found by the `D3.7` review.
       */
      setFormError(messageForError(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)}>
      <fieldset aria-busy={pending} disabled={pending}>
        {/*
         * §3's 16px card stack, over `FieldGroup`'s own `gap-7` (28px) — the
         * login card's rung, not the 20px field stack `@repo/form`'s record
         * shells take (ADR-0054 §7).
         */}
        <FieldGroup className="gap-4">
          <Field data-invalid={Boolean(fieldErrors.email)}>
            <FieldLabel htmlFor="email">{t("fields.email")}</FieldLabel>
            <Input
              autoComplete="username"
              className={LOGIN_INPUT}
              id="email"
              name="email"
              onChange={(event) => {
                setEmail(event.target.value);
              }}
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
              autoComplete="current-password"
              className={LOGIN_INPUT}
              id="password"
              name="password"
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              type="password"
              value={password}
            />
            {fieldErrors.password ? (
              <FieldError>{fieldErrors.password}</FieldError>
            ) : null}
          </Field>

          {formError === null ? null : (
            <FieldError role="alert">{formError}</FieldError>
          )}

          <Button className={LOGIN_CONTROL} type="submit">
            {pending ? t("submitting") : t("submit")}
          </Button>
        </FieldGroup>
      </fieldset>
    </form>
  );
};
