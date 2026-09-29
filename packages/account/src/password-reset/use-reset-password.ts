import {
  CREDENTIAL_MUTATION,
  isApiClientError,
  useApiClient,
  type ErrorMessage,
} from "@repo/api-client";
import { resetPasswordBody, type ResetPasswordBody } from "@repo/contracts";
import type { TranslationKey } from "@repo/i18n";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * What the `/reset-password` screen has to say while it says it (ADR-0071 §4).
 *
 * Two states. A recovery link only opens a form: nothing is spent until
 * somebody has chosen a password and pressed the button, and until then the
 * screen is simply `ready`.
 *
 * `refused` covers **both** ways there is nothing to spend: no token in the
 * address, and a token the API would not take. They are one sentence on
 * purpose. Nothing in either app sends anybody to this address empty-handed —
 * it is where a mailed link lands and nowhere else — so the only way to arrive
 * without a fragment is a link that has lost one, which is the same
 * predicament as a link that has been spent. And the API refuses every failure
 * with one indistinguishable `401` (ADR-0071 §4), so a client offering a
 * sharper story would be inventing a distinction the server declines to make.
 */
export type PasswordResetStatus = "ready" | "refused";

/** What the screen renders from. */
export interface PasswordReset {
  readonly status: PasswordResetStatus;
  /** True while the new password is in flight. */
  readonly pending: boolean;
  /**
   * The catalogue sentence for a refusal that is **not** the link's own — a
   * `429` from the submit budget, a validation failure the server saw and the
   * browser did not, an unreachable API (ADR-0034's code map).
   */
  readonly formError: string | null;
  /** zod's own message for the password, localized by the client error map. */
  readonly fieldError: string | null;
  /** Spends the held link on this password. */
  readonly submit: (newPassword: string) => void;
}

/**
 * Where the screen goes, as the app's router spells it (ADR-0077 §2).
 *
 * Navigation leaves this package as callbacks, because a router types its
 * destinations against the app's own route tree. **Both functions must be
 * referentially stable** — the hook that returns them memoises — because the
 * strike is an effect dependency.
 */
export interface RecoveryNavigation {
  /**
   * Empties the fragment of the address the screen is on, replacing the
   * history entry. Rejects when the router cancels the navigation.
   */
  readonly strikeToken: () => Promise<void>;
  /** Lands on sign-in, replacing the history entry. */
  readonly toSignIn: () => Promise<void>;
}

export interface ResetPasswordDeps {
  /** The app's code map over its own `errors` catalogue (ADR-0034). */
  readonly useMessageForError: () => ErrorMessage;
  /**
   * The address's fragment as the app's router reads it: **without the
   * leading `#`**, which is how TanStack Router's `location.hash` spells it.
   * `window.location.hash` keeps the `#`, and a binding that handed that over
   * would find no token in any link.
   */
  readonly useLocationHash: () => string;
  readonly useRecoveryNavigation: () => RecoveryNavigation;
  /**
   * The sentence the sign-in screen shows after a reset, where an app has one
   * (ADR-0072 §4): in the customer app a reset by mail may have unlinked
   * Google, and that has to be said on the screen it lands on. The admin
   * passes none and the landing is silent.
   */
  readonly outcome?: TranslationKey | undefined;
}

/** The fragment's one parameter, as ADR-0071 §1 spells the address. */
const TOKEN_PARAM = "token";

/**
 * Reads the recovery token out of `#token=…`.
 *
 * `URLSearchParams` rather than a split on `=`: the token is opaque, its
 * encoding is the mint's business (`accountTokenSchema`'s own comment), and a
 * value that ever grew a `=` would be truncated by anything hand-rolled. An
 * empty or absent parameter is `undefined` rather than `""`, so "no link" and
 * "an empty link" are one state.
 */
const tokenFromHash = (hash: string): string | undefined => {
  const token = new URLSearchParams(hash).get(TOKEN_PARAM);

  return token === null || token === "" ? undefined : token;
};

/**
 * Turns a recovery link and a typed password into a new credential (ADR-0071
 * §4) — one hook for both apps since `D22.2` (ADR-0077 §2).
 *
 * The credential arrives in a URL fragment, inheriting ADR-0057 §2's mechanism
 * whole through ADR-0071 §1.
 *
 * **The fragment is struck from the address as soon as it has been read.**
 * This token is not spent on arrival, so without the strike it would sit in
 * the address bar for as long as somebody takes to choose a password — in the
 * session history, in whatever a screen-share is showing, and in a `Referer`
 * the moment anything on the page loads a third-party asset. `replace` rather
 * than a push, so Back cannot walk to the entry that carried it.
 *
 * **The credential waits in a ref, never in state and never in the DOM.** It
 * has to survive until somebody submits, and a ref is what survives without
 * being rendered, persisted or handed to React DevTools; it is cleared the
 * moment the API refuses it, and it goes with the screen.
 *
 * **It starts no session.** The endpoint answers `204` and revokes every
 * session the account had — the link proved the mailbox, not the device — so
 * the screen lands on sign-in with a password that is now known rather than on
 * a screen it has no right to. That is also why there is no "are you sure"
 * gate for a browser that already holds a session, which `/verify-email` grew
 * at `D18.4`: this link issues no session at all, and spending it requires
 * choosing a password.
 */
export const createUseResetPassword = ({
  useMessageForError,
  useLocationHash,
  useRecoveryNavigation,
  outcome,
}: ResetPasswordDeps): (() => PasswordReset) => {
  /**
   * How the request is sent, decided once per binding and never per render.
   *
   * **The two apps sent it two ways, and both are kept.** Where an app has an
   * outcome sentence the request is a mutation, for that sentence and nothing
   * else (ADR-0072 §4, amended between `D19.2` and `D19.3`): ADR-0034's one
   * global handler delivers `meta.success` to the `<Toaster>` on the root
   * route, which survives the navigation to sign-in. The screen's refusals
   * stay its own, so `errorToast: false`, and `CREDENTIAL_MUTATION` because
   * the new password is the mutation's `variables`.
   *
   * Where an app has none the request is the client's own call, as the admin
   * has always made it. The difference is observable: a mutation waits for the
   * browser to be online before it sends, and a direct call fails at once with
   * the code map's sentence and hands the form back.
   */
  const useSpend: () => (body: ResetPasswordBody) => Promise<void> =
    outcome === undefined
      ? () => {
          const client = useApiClient();

          return useCallback(
            (body: ResetPasswordBody) => client.resetPassword(body),
            [client],
          );
        }
      : () => {
          const client = useApiClient();

          return useMutation({
            ...CREDENTIAL_MUTATION,
            mutationFn: (body: ResetPasswordBody) => client.resetPassword(body),
            meta: { errorToast: false, success: outcome },
          }).mutateAsync;
        };

  return (): PasswordReset => {
    const spend = useSpend();
    const { strikeToken, toSignIn } = useRecoveryNavigation();
    const messageForError = useMessageForError();
    const hash = useLocationHash();

    /*
     * A boolean, not the value. The initializer runs on the first render only,
     * so this answers "did a link arrive" about the *arriving* address rather
     * than about whatever the bar holds after the effect empties it — and it
     * answers it without retaining the credential to do so.
     */
    const [arrived] = useState(() => tokenFromHash(hash) !== undefined);
    const [status, setStatus] = useState<PasswordResetStatus>(
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

      /*
       * **No latch, and its absence is the fix rather than an oversight**
       * (`D18.6`, `code-reviewer`). This effect is self-terminating without
       * one: the strike below empties the fragment, `hash` is a dependency,
       * and the re-run finds no token and returns — which is also what
       * releases the first closure, and with it the only reference to the
       * credential outside the ref. A `struck` ref stood here and made a
       * *second* link pasted into an already-open tab both unusable and
       * un-struck: a fragment-only change reloads no document, so the effect
       * would have returned on the latch with the stale token still held and
       * the new one still sitting in the address bar — the one thing the
       * strike exists to prevent.
       *
       * `.then`'s two arms rather than a bare `.catch`: a router rejects a
       * navigation that is cancelled, and an unhandled rejection out of a
       * replace would be noise nobody can act on. The fulfilled arm puts the
       * screen back in `ready`, which is what lets a fresh link land on a tab
       * that is sitting on the dead-link sentence. It is a promise callback
       * rather than a line in this body because the repository's own
       * `react-hooks/set-state-in-effect` refuses a synchronous setState in
       * an effect — and on the ordinary arrival both calls are no-ops React
       * bails out of, since the screen is already in exactly that state.
       */
      void strikeToken().then(
        () => {
          setStatus("ready");
          setFormError(null);
        },
        () => undefined,
      );
    }, [hash, strikeToken]);

    const submit = useCallback(
      (newPassword: string) => {
        const token = held.current;

        if (token === undefined) {
          setStatus("refused");
          return;
        }

        setFieldError(null);
        setFormError(null);

        /*
         * `resetPasswordBody` is the object the API validates with (ADR-0011,
         * ADR-0023), so the policy this password is held to is the policy it
         * will be held to — and it is the *whole* body that is parsed, token
         * included, because a token this screen mangled must fail here rather
         * than as a `401` that reads as a dead link.
         */
        const parsed = resetPasswordBody.safeParse({ token, newPassword });

        if (!parsed.success) {
          const issue = parsed.error.issues[0];

          // A token that will not parse is not something a person can act on
          // by typing a better password: it is a broken link, and it says so.
          if (issue?.path[0] === "token") {
            held.current = undefined;
            setStatus("refused");
            return;
          }

          setFieldError(issue?.message ?? null);
          return;
        }

        setPending(true);

        spend(parsed.data).then(
          () => {
            held.current = undefined;
            /*
             * Sign-in, and `replace` so `/reset-password` stays out of the
             * history: the screen's job is done, the account's sessions are
             * all revoked, and Back must not return to a form holding a link
             * that no longer works. There is no session to land anywhere else
             * with — that is §4's decision, not an omission.
             */
            void toSignIn().catch(() => {
              /*
               * A cancelled navigation would otherwise leave the form
               * disabled for good, because success is the one path that never
               * clears `pending` (`D18.6`, `security-reviewer`'s residual
               * list). The link is spent either way, so what is left standing
               * is a form somebody can read rather than a frozen one.
               */
              setPending(false);
            });
          },
          (error: unknown) => {
            setPending(false);

            /*
             * The one refusal with its own screen. Every way the link can be
             * bad answers `401` (ADR-0071 §4) and none of them is something a
             * different password would fix, so the form goes away and the way
             * to another link takes its place. Everything else — the submit
             * budget's `429` above all — leaves the form standing, because
             * trying again in a moment is exactly the right thing to do.
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
      [spend, messageForError, toSignIn],
    );

    return { status, pending, formError, fieldError, submit };
  };
};
