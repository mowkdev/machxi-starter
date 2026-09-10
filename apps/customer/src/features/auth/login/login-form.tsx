import { loginBody } from "@repo/contracts";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { useLandingSlug } from "@/entities/organization";

import { isApiClientError } from "@/shared/api/api-error";
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

import { awaitingVerification } from "../verify-email/awaited-address";

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
  const landingSlug = useLandingSlug();
  const { redirect } = useSearch({ from: "/_auth/login" });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  /**
   * Whether the last refusal was `403 AUTH_EMAIL_UNVERIFIED` (ADR-0071 §3).
   *
   * **The one refusal on this screen with something to offer.** Every other
   * failure is answered by the catalogue sentence and nothing else, because
   * there is nothing a customer can do about it here. This one has a way
   * forward — the link is in a mailbox, or a new one is a click away — and the
   * code is deliberately distinguishable, so the affordance is honest rather
   * than a guess (the password has already been proven, which is what leaves
   * ADR-0020 §Enumeration nothing to protect).
   *
   * A boolean beside the sentence rather than the whole error in state: the
   * sentence still comes from the code map, and what is new is only whether to
   * draw a link under it.
   */
  const [unverified, setUnverified] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);
    setUnverified(false);

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
       * next — which is why the landing rule lives here and not in the entity
       * layer, that layer being the one that may not know the route tree
       * (ADR-0049). `redirect` is the location `_dashboard`'s guard turned
       * away, already fenced to a same-origin path by the route's
       * `validateSearch`.
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
      const { principal } = await client.login(parsed.data);

      if (redirect !== undefined) {
        await navigate({ href: redirect });
        return;
      }

      /*
       * **Where sign-in lands when the guard recorded no `redirect`** (`D15.9`,
       * ADR-0067 §6 as amended 2026-09-07): the team this device last had this
       * principal in, or `/` when there is none.
       *
       * This is one of the remembered key's exactly two consumers, and it is
       * checked against the memberships rather than trusted — the value is on
       * the customer's own device, so a team they have since left would
       * otherwise send them to a not-found on every sign-in, forever, with
       * nothing the server could do about it. `useLandingSlug` fetches only
       * when something is remembered, so an account that has never been in a
       * team pays nothing for this.
       *
       * The `redirect` branch still wins outright and is spent first: a session
       * that expired mid-task returns somebody to the screen they were on,
       * which is a stronger statement about where they wanted to be than
       * anything a device remembers.
       */
      /*
       * **Caught, because a convenience must not be able to fail a sign-in**
       * (a review finding). `useLandingSlug` fetches the memberships when
       * something is remembered, and `fetchQuery` *rejects* when that read
       * fails — inside this `try` that rejection would land in the `catch`
       * below and paint a refusal under the form of a customer who is, by
       * then, already signed in and holding a live session. Landing on the
       * private home is the right answer to "we could not find out".
       */
      const slug = await landingSlug(principal.id).catch(() => undefined);

      await (slug === undefined
        ? navigate({ to: "/" })
        : navigate({ params: { orgSlug: slug }, to: "/orgs/$orgSlug" }));
    } catch (error) {
      setFormError(messageForError(error));
      setUnverified(
        isApiClientError(error) && error.code === "AUTH_EMAIL_UNVERIFIED",
      );
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

          {/*
           * The way out of the one refusal that has one (ADR-0071 §3). The
           * address travels as history state so the resend control on the
           * other side starts filled in with what was just typed — this screen
           * is the only place that knows it, and the confirmation screen would
           * otherwise ask for it a second time.
           *
           * A link rather than a button that resends from here: `/verify-email`
           * is where the outcome is said and where a person waits, and firing
           * the request from under a sign-in form would leave them on a screen
           * that still says they cannot sign in.
           */}
          {unverified ? (
            <Link
              className="text-[13px] leading-5 font-medium underline underline-offset-4"
              state={awaitingVerification(email)}
              to="/verify-email"
            >
              {t("unverified.resend")}
            </Link>
          ) : null}

          <Button className={LOGIN_CONTROL} type="submit">
            {pending ? t("submitting") : t("submit")}
          </Button>
        </FieldGroup>
      </fieldset>
    </form>
  );
};
