import { acceptOnboardingBody } from "@repo/contracts";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { isApiClientError } from "@/shared/api/api-error";
import { useApiClient } from "@/shared/api/context";
import { useMessageForError } from "@/shared/notifications/messages";

/**
 * What the `/onboarding` screen has to say while it says it (ADR-0071 §8).
 *
 * **`useResetPassword`'s twin**, and every property of it is here for that
 * hook's reason rather than a new one: the two screens both spend a
 * single-use credential that arrived in a URL fragment on a password somebody
 * types, so the fragment is struck on arrival, the credential waits in a ref,
 * and `refused` covers both ways there is nothing to spend. Read that hook for
 * the arguments; what follows is only what differs.
 *
 * **It ends in a session, where the reset ends on the sign-in screen.** §8's
 * accept answers login's body, because this link is the only way this account
 * has ever been reachable and the person at the other end has just chosen its
 * credential — there is no earlier password for anybody else to be holding,
 * which is the thing §4 revokes every session over.
 *
 * **And a dead link here has no self-service way forward.** A customer whose
 * recovery link expired asks for another from `/forgot-password`; an operator
 * who has never had a password cannot, because every sender in this app is
 * behind a session. So the screen says to ask an administrator, and the
 * control it offers is the sign-in page rather than a button that would mail
 * nothing.
 */
export type OnboardingStatus = "ready" | "refused";

/** What the screen renders from. */
export interface Onboarding {
  readonly status: OnboardingStatus;
  /** True while the chosen password is in flight. */
  readonly pending: boolean;
  /**
   * The catalogue sentence for a refusal that is **not** the link's own — the
   * submit budget's `429`, a validation failure the server saw and the browser
   * did not, an unreachable API (ADR-0034's code map).
   */
  readonly formError: string | null;
  /** zod's own message for the password, localized by the client error map. */
  readonly fieldError: string | null;
  /** Spends the held link on this password. */
  readonly submit: (password: string) => void;
}

/** The fragment's one parameter, as ADR-0071 §1 spells the address. */
const TOKEN_PARAM = "token";

/** Reads the onboarding token out of `#token=…` — `useResetPassword`'s reader. */
const tokenFromHash = (hash: string): string | undefined => {
  const token = new URLSearchParams(hash).get(TOKEN_PARAM);

  return token === null || token === "" ? undefined : token;
};

/**
 * Turns an onboarding link and a chosen password into an operator's first
 * session (ADR-0071 §8).
 *
 * **The exchange goes through `@repo/api-client`'s `acceptOnboarding`** and
 * not through anything this feature writes: the response is login's body, so
 * the session store keeps its single writer (ADR-0033).
 *
 * **The link is not spent on arrival**, which is the difference from the
 * customer app's `/verify-email` and the reason this screen needs no
 * already-signed-in gate of its own. Nothing happens until a password is
 * typed and submitted, so an operator sitting in a browser signed in as
 * somebody else cannot be moved into this account by opening a URL — the
 * forced-login shape that gate exists to refuse. What they can do is choose a
 * password deliberately and be signed in as the new account, which is the
 * request they just made.
 */
export const useAcceptOnboarding = (): Onboarding => {
  const client = useApiClient();
  const navigate = useNavigate();
  const messageForError = useMessageForError();
  const hash = useRouterState({ select: (state) => state.location.hash });

  /*
   * A boolean, not the value: this answers "did a link arrive" about the
   * *arriving* address rather than about whatever the bar holds after the
   * effect empties it, and answers it without retaining the credential.
   */
  const [arrived] = useState(() => tokenFromHash(hash) !== undefined);
  const [status, setStatus] = useState<OnboardingStatus>(
    arrived ? "ready" : "refused",
  );
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  /** The link this screen is holding, until it is spent or refused. */
  const held = useRef<string | undefined>(undefined);

  useEffect(() => {
    const token = tokenFromHash(hash);

    if (token === undefined) return;

    held.current = token;

    // No latch, and its absence is `useResetPassword`'s fix rather than an
    // oversight: the strike empties the fragment, `hash` is a dependency, and
    // the re-run finds no token and returns — which is also what releases the
    // first closure and with it the only reference to the credential outside
    // the ref. A latch would make a second link pasted into an already-open
    // tab both unusable and un-struck.
    /*
     * Both arms, and the rejected one is not decoration: TanStack rejects a
     * navigation that is cancelled, so `.then(f, undefined)` would leave a
     * derived promise rejecting with nothing attached — noise nobody can act
     * on, and in Vitest an unhandled rejection that fails an unrelated test
     * (`D18.11`'s `code-reviewer`). `useResetPassword` carries the same pair
     * for the same reason.
     */
    void navigate({ to: "/onboarding", hash: "", replace: true }).then(
      () => {
        setStatus("ready");
        setFormError(null);
      },
      () => undefined,
    );
  }, [hash, navigate]);

  const submit = useCallback(
    (password: string) => {
      const token = held.current;

      if (token === undefined) {
        setStatus("refused");
        return;
      }

      setFieldError(null);
      setFormError(null);

      /*
       * `acceptOnboardingBody` is the object the API validates with (ADR-0011,
       * ADR-0023), so the policy this password is held to is the policy it
       * will be held to — and it is the *whole* body that is parsed, token
       * included, because a token this screen mangled must fail here rather
       * than as a `401` that reads as a dead link.
       */
      const parsed = acceptOnboardingBody.safeParse({ token, password });

      if (!parsed.success) {
        const issue = parsed.error.issues[0];

        // A token that will not parse is not something a person can act on by
        // typing a better password: it is a broken link, and it says so.
        if (issue?.path[0] === "token") {
          held.current = undefined;
          setStatus("refused");
          return;
        }

        setFieldError(issue?.message ?? null);
        return;
      }

      setPending(true);

      client.acceptOnboarding(parsed.data).then(
        () => {
          held.current = undefined;
          /*
           * The dashboard, and `replace` so `/onboarding` stays out of the
           * history: the account is set up and signed in, and Back must not
           * return to a form holding a link that no longer works. There is a
           * session to land with, which is §8's decision and the difference
           * from the recovery screen next door.
           */
          void navigate({ to: "/", replace: true }).catch(() => {
            // A cancelled navigation would otherwise leave the form disabled
            // for good, because success is the one path that never clears
            // `pending`. The link is spent either way, so what is left
            // standing is a form somebody can read rather than a frozen one.
            setPending(false);
          });
        },
        (error: unknown) => {
          setPending(false);

          /*
           * The one refusal with its own screen. Every way the link can be bad
           * answers `401` (ADR-0071 §8) and none of them is something a
           * different password would fix, so the form goes away and the
           * instruction takes its place. Everything else — the submit budget's
           * `429` above all — leaves the form standing, because trying again
           * in a moment is exactly the right thing to do.
           */
          if (isApiClientError(error) && error.status === 401) {
            held.current = undefined;
            setStatus("refused");
            return;
          }

          setFormError(messageForError(error));
        },
      );
    },
    [client, messageForError, navigate],
  );

  return { status, pending, formError, fieldError, submit };
};
