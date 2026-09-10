import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { useApiClient, useSession } from "@/shared/api/context";

/**
 * What the `/verify-email` screen has to say while it says it (ADR-0071 §3).
 *
 * The `/impersonate` exchange's three states, and success is not one of them
 * for the same reason: success is a navigation. What differs is the third
 * name. The handoff screen calls "no token in the address" `missing`, because
 * arriving there without a link is a mishap; here it is the **ordinary**
 * landing — sign-up sends a person straight to this address to be told a link
 * is on its way — so it is `awaiting`, and the copy under it is the
 * check-your-mail screen rather than an apology.
 *
 * There is deliberately no "the link was expired" apart from "the link was
 * refused": ADR-0071 §3 answers every failure with one indistinguishable
 * `401`, so a client offering two sentences would be inventing a distinction
 * the API refuses to make. The way forward out of both is the same one
 * control — ask for another link — which is why the screen carries one.
 *
 * **And a fourth the handoff screen has no need of: `signedIn`** (ADR-0071 §3
 * as amended by `D18.4`, out of that step's `security-reviewer`). A browser
 * that already holds a session is asked before the link is spent, because a
 * client that spends a fragment on mount is a forced-login primitive and this
 * token's class is not ADR-0057 §2's: a handoff is minted by an authenticated
 * operator and lives sixty seconds, while **anyone** can mint a verification
 * token by registering an address they control, and it lives a day. So an
 * attacker can hold a live link and get a signed-in person to open it — on the
 * app's own origin, which is not a cross-site request for `SameSite` or the
 * transport header to refuse — and that person then works inside the
 * attacker's account without ever having typed a password.
 */
export type VerificationStatus =
  "pending" | "refused" | "awaiting" | "signedIn";

/** What the screen renders from. */
export interface EmailVerification {
  readonly status: VerificationStatus;
  /**
   * Spends the link this screen is holding.
   *
   * Meaningful on `signedIn` and a no-op everywhere else, because everywhere
   * else there is nothing held: the token was spent on arrival, or none came.
   */
  readonly confirm: () => void;
}

/** The fragment's one parameter, as ADR-0071 §1 spells the address. */
const TOKEN_PARAM = "token";

/**
 * Reads the confirmation token out of `#token=…`.
 *
 * `URLSearchParams` rather than a split on `=`, for `useRedeemHandoff`'s
 * reason: the token is opaque, its encoding is the mint's business
 * (`accountTokenSchema`'s own comment), and a value that ever grew a `=` would
 * be truncated by anything hand-rolled. An empty or absent parameter is
 * `undefined` rather than `""`, so "no link" and "an empty link" are one state.
 */
const tokenFromHash = (hash: string): string | undefined => {
  const token = new URLSearchParams(hash).get(TOKEN_PARAM);

  return token === null || token === "" ? undefined : token;
};

/**
 * Turns the confirmation link's fragment into a session (ADR-0071 §3).
 *
 * **The handoff hook's twin, and the resemblance is the design rather than
 * copy-paste**: both spend a single-use credential that arrived in a URL
 * fragment, and ADR-0071 §1 inherits ADR-0057 §2's mechanism whole. So the
 * three properties are the same three, and each is here for its own reason.
 *
 * **The exchange goes through `@repo/api-client`'s `verifyEmail` and not
 * through anything this feature writes.** The response is login's body, the
 * session store keeps its single writer, and a feature that hydrated it would
 * be a second writer of the state that package exists to own (ADR-0033).
 *
 * **The fragment is struck from the address as soon as it has been read.** The
 * token is single-use and a *refused* consumption deliberately spends nothing
 * (ADR-0071 §1), so a link that failed for a reason other than the token —
 * an account disabled a minute ago — stays redeemable for the rest of its day
 * while sitting in the address bar. A day, not the handoff's sixty seconds,
 * which makes the window wider here than the screen this is modelled on.
 * `replace` rather than a push, so Back cannot walk to the entry that carries
 * it.
 *
 * **Nothing durable holds the credential, and on one branch it is held in a
 * ref.** On the ordinary path — no session in this browser — the token lives
 * only in the effect's closure and in the settlement callbacks, so it is
 * released when the exchange settles rather than sitting in component state
 * for as long as somebody leaves a refused screen open, where any same-origin
 * script and React DevTools could read it. On the `signedIn` branch the link
 * has to survive until somebody clicks, and it waits in a **ref** rather than
 * in state: not persisted, not rendered, cleared the moment it is spent, and
 * gone with the screen. The alternative was to leave the fragment in the
 * address bar until the click, which is the exposure the strike exists to
 * close.
 *
 * A ref latches the attempt rather than a dependency array, and the reason is
 * `StrictMode`: development double-invokes effects, and the second invocation
 * would post the same token again — which the API answers correctly, with a
 * `401` on an already-consumed token, having just minted a session this screen
 * would then abandon. One attempt per mount is the property, and only a latch
 * outside React's state gives it.
 */
export const useVerifyEmail = (): EmailVerification => {
  const client = useApiClient();
  const navigate = useNavigate();
  const session = useSession();
  const hash = useRouterState({ select: (state) => state.location.hash });

  /*
   * A boolean, not the value. The initializer runs on the first render only,
   * so this answers "did a link arrive" about the *arriving* address rather
   * than about whatever the bar holds after the effect empties it — and it
   * answers it without retaining the credential to do so.
   */
  const [arrived] = useState(() => tokenFromHash(hash) !== undefined);
  /*
   * Read once, at mount, for the same reason: the exchange **replaces** the
   * session, so a live read would answer "signed in" about the session this
   * screen just created and re-gate a link that has already been spent.
   */
  const [signedIn] = useState(() => session.isAuthenticated);
  const [status, setStatus] = useState<VerificationStatus>(
    arrived ? (signedIn ? "signedIn" : "pending") : "awaiting",
  );
  const attempted = useRef(false);
  /** The link waiting for a click, on the `signedIn` branch and nowhere else. */
  const held = useRef<string | undefined>(undefined);

  const spend = useCallback(
    (token: string) => {
      held.current = undefined;

      /*
       * **No `setStatus("pending")` here**, and the omission is the repository's
       * own lint rule rather than a preference: this runs synchronously inside
       * the effect below, and `react-hooks/set-state-in-effect` refuses a
       * synchronous setState in an effect body. The two callers each put the
       * screen in `pending` where they can — the mount seeds it, and `confirm`
       * sets it before calling — which covers every state a person can see.
       * `D18.4`'s `code-reviewer` raised the one case that leaves uncovered,
       * and the notes record why it is left: a link pasted into the address bar
       * of a tab already sitting here, which the reviewer marked uncertain and
       * which costs at worst a resend that supersedes a token in flight — an
       * outcome the screen already has one sentence for.
       */
      client.verifyEmail(token).then(
        () => {
          /*
           * Home, and `replace` so `/verify-email` stays out of the history:
           * the person has just proven the address and is signed in, and Back
           * from the home screen must not land on a screen whose whole job is
           * done. There is no `redirect` to spend — nothing turned a brand-new
           * account away from a page it had not yet been able to reach — and no
           * landing organization to look up either, because the only membership
           * a just-verified account has is the personal one `/` already is.
           */
          void navigate({ to: "/", replace: true }).catch(() => undefined);
        },
        () => {
          setStatus("refused");
        },
      );
    },
    [client, navigate],
  );

  useEffect(() => {
    if (attempted.current) return;

    const token = tokenFromHash(hash);

    if (token === undefined) return;

    attempted.current = true;

    /*
     * `.catch` on both navigations because TanStack rejects a navigation that
     * is cancelled, and the success path deliberately unmounts this screen: an
     * unhandled rejection out of a redirect would be noise nobody can act on.
     *
     * Struck on **both** branches, before anything else: the credential is out
     * of the address bar whether it is about to be spent or about to wait.
     */
    void navigate({ to: "/verify-email", hash: "", replace: true }).catch(
      () => undefined,
    );

    /*
     * The gate (ADR-0071 §3 as amended at `D18.4`). Signed out — the ordinary
     * arrival — the link is spent on sight and nothing changes. Signed in, it
     * waits for a person to say so, because otherwise any live link is a way
     * to move somebody into an account they did not ask for.
     */
    if (signedIn) {
      held.current = token;
      return;
    }

    spend(token);
    /*
     * `hash` is a dependency and the strike above changes it, so this effect
     * runs a second time — and returns on the latch. That re-run is what
     * releases the first closure, and with it the only reference to the token
     * that outlives the request itself.
     */
  }, [navigate, hash, signedIn, spend]);

  const confirm = useCallback(() => {
    const token = held.current;

    if (token === undefined) return;

    // An event handler, so the screen may move to `pending` here — which is
    // what takes the confirmation button away and stops a second click on a
    // token that is already in flight.
    setStatus("pending");
    spend(token);
  }, [spend]);

  return { status, confirm };
};
