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
 * ADR-0054 §7's 38px login rung and §3's 13/18 control type, spelled on the
 * call site.
 *
 * Two constants rather than one because the two primitives re-raise the size
 * differently: `Button`'s base is a plain `text-sm`, which `text-[13px]`
 * displaces outright, while `Input` ships `text-base md:text-sm` and takes its
 * own size back from 768px up — so the field, and only the field, needs the
 * `md:` twin.
 *
 * Reached through `className` on the generated primitives rather than by
 * editing them, which is ADR-0047's byte-identical rule.
 */
const LOGIN_CONTROL = "h-[38px] text-[13px]";
const LOGIN_INPUT = `${LOGIN_CONTROL} md:text-[13px]`;

/**
 * The login form (ADR-0033 §Boot is the other half of this).
 *
 * A feature, because ADR-0049 gives features the interactions that *change*
 * something. It validates with `loginBody` from `@repo/contracts` — the same
 * object the API validates with (ADR-0011/0023), so client and server cannot
 * disagree about what a password must be.
 *
 * **Hand-wired rather than config-driven**, and for this app the reason is not
 * ordering but shape: ADR-0035's `AppFormInput` and the `@repo/form` record
 * shells exist and this app could import them — but they are built around a
 * record being edited (a create surface, an edit surface, a dialog), and a
 * login is neither. The admin reached the same conclusion from the other
 * direction, and its form is the same shape. What the machinery would have
 * enforced is honoured by hand: **every field is disabled while the request is
 * in flight**, on a `fieldset` so nothing unregistered escapes.
 *
 * The refusal is rendered through ADR-0034's code-to-message map, never from
 * the API's own `message` — that is a developer-facing English default
 * (ADR-0013), and showing it would bypass the i18n seam and put wording nobody
 * wrote for a customer on a customer's screen.
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
      /*
       * The client hydrates the store; this feature only decides where to go
       * next. `redirect` is the location `_dashboard`'s guard turned away,
       * already fenced to a same-origin path by the route's `validateSearch`.
       *
       * **`href`, not `to`, and the difference is not cosmetic.** The guard
       * records `location.href` — pathname *and* search *and* hash — and
       * `buildLocation` resolves a `to` through `resolvePathWithBase` without
       * splitting on `?` or `#`, so `/orders?status=open` would interpolate
       * whole into the pathname and 404. The `href` branch parses the three
       * parts and still resolves against the router's own origin, so the fence
       * `validateSearch` put on the value is untouched.
       *
       * Silent today, because no protected route carries search yet. Found by
       * `D12.2`'s review reading `@tanstack/router-core` rather than by a
       * failing test, and fixed now because the step that adds the first such
       * route would have inherited it.
       */
      await client.login(parsed.data);
      await (redirect === undefined
        ? navigate({ to: "/" })
        : navigate({ href: redirect }));
    } catch (error) {
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
         * login card's rung (ADR-0054 §7).
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
