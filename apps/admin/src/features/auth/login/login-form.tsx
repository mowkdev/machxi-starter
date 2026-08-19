import { loginBody } from "@repo/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { useApiClient } from "@/shared/api/context";
import { isApiClientError } from "@/shared/api/api-error";
import {
  Button,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
} from "@/shared/ui";

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
 */
export const LoginForm = () => {
  const client = useApiClient();
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
       * Branching on the code, not on `isApiClientError`: every rejection out
       * of the client satisfies that by design (ADR-0033's invariant), so the
       * friendly fallback would have been dead code and a dropped socket would
       * have rendered axios's "Network Error" to an operator.
       *
       * `D3.5` replaces this with ADR-0034's code-to-message map, which is
       * where every code gets a sentence written for a human.
       */
      const message =
        isApiClientError(error) && error.code !== "SERVICE_UNAVAILABLE"
          ? error.message
          : "The API could not be reached. Try again.";

      setFormError(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)}>
      <fieldset aria-busy={pending} disabled={pending}>
        <FieldGroup>
          <Field data-invalid={Boolean(fieldErrors.email)}>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              autoComplete="username"
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
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              autoComplete="current-password"
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

          <Button type="submit">{pending ? "Signing in…" : "Sign in"}</Button>
        </FieldGroup>
      </fieldset>
    </form>
  );
};
