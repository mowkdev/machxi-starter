import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { useApiClient } from "@/shared/api/context";

/**
 * What the `/impersonate` screen has to say while it says it (`D13.7`).
 *
 * Three states and no fourth: success is not one of them, because success is a
 * navigation. There is deliberately no "the token was expired" apart from "the
 * token was refused" — ADR-0057 §3 answers every failure with one
 * indistinguishable `401`, so a client that offered two sentences would be
 * inventing a distinction the API refuses to make.
 */
export type HandoffStatus = "pending" | "refused" | "missing";

/** The fragment's one parameter, as ADR-0057 §2 spells the address. */
const HANDOFF_PARAM = "token";

/**
 * Reads the handoff out of `#token=…`.
 *
 * `URLSearchParams` rather than a split on `=`: the token is opaque and
 * `randomToken(32)` is base64url today, but the encoding is the mint's
 * business (`handoffTokenSchema`'s own comment) and a value that ever grew a
 * `=` would be truncated by anything hand-rolled. An empty or absent parameter
 * is `undefined` rather than `""`, so "no link" and "an empty link" are one
 * state rather than two.
 */
const handoffFromHash = (hash: string): string | undefined => {
  const token = new URLSearchParams(hash).get(HANDOFF_PARAM);

  return token === null || token === "" ? undefined : token;
};

/**
 * Turns the URL fragment into a session (ADR-0057 §3, §7).
 *
 * **The redemption goes through `@repo/api-client`'s `redeemHandoff` and not
 * through anything this feature writes**, which is the rule the plan's step
 * names first: the session store keeps its single writer set, and a feature
 * that hydrated it would be a second writer of the state that package exists
 * to own. What is left here is the part that is genuinely this app's — where
 * the credential is read from, when it is spent, and what a customer sees
 * while it happens.
 *
 * **The fragment is struck from the address as soon as it has been read.** The
 * token is a one-time credential (ADR-0057 §2) and a refused exchange
 * deliberately does *not* spend it (§3), so a link that failed for a reason
 * other than the token — a target disabled a minute ago — stays redeemable for
 * the rest of its sixty seconds while sitting in the address bar and in
 * whatever a screen-share is showing. `replace` rather than a push, so Back
 * cannot walk to the entry that still carries it.
 *
 * **Nothing durable holds the credential** (`D13.7`'s `security-reviewer`
 * pass). Only a boolean survives the first render: the token itself lives in
 * the effect's closure and in the settlement callbacks, so it is released when
 * the exchange settles rather than sitting in component state for as long as
 * an operator leaves a refused screen open — where any same-origin script and
 * React DevTools could read it. A first draft kept it in `useState`, which the
 * success path bounded by unmounting and the refusal path did not bound at all.
 *
 * A ref latches the attempt rather than a dependency array, and the reason is
 * `StrictMode`: development double-invokes effects, and the second invocation
 * would post the same token a second time — which the API answers correctly,
 * with a `401` on an already-consumed handoff, having just minted a session
 * this screen would then abandon. One attempt per mount is the property, and
 * only a latch outside React's state gives it.
 */
export const useRedeemHandoff = (): HandoffStatus => {
  const client = useApiClient();
  const navigate = useNavigate();
  const hash = useRouterState({ select: (state) => state.location.hash });

  /*
   * A boolean, not the value. The initializer runs on the first render only,
   * so this answers "did a link arrive" about the *arriving* address rather
   * than about whatever the bar holds after the effect empties it — and it
   * answers it without retaining the credential to do so.
   */
  const [arrived] = useState(() => handoffFromHash(hash) !== undefined);
  const [status, setStatus] = useState<HandoffStatus>(
    arrived ? "pending" : "missing",
  );
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;

    const handoff = handoffFromHash(hash);

    if (handoff === undefined) return;

    attempted.current = true;

    /*
     * `.catch` on both navigations because TanStack rejects a navigation that
     * is cancelled, and the success path deliberately unmounts this screen: an
     * unhandled rejection out of a redirect would be noise nobody can act on.
     */
    void navigate({ to: "/impersonate", hash: "", replace: true }).catch(
      () => undefined,
    );

    client.redeemHandoff(handoff).then(
      () => {
        /*
         * Home rather than back to wherever the operator was: there is no
         * "back" — this tab arrived on a link — and `/` is the one address
         * this app can name for a session it has just started. `replace`
         * keeps `/impersonate` out of the history, so Back from the home
         * screen does not land on a screen whose whole job is already done.
         */
        void navigate({ to: "/", replace: true }).catch(() => undefined);
      },
      () => {
        setStatus("refused");
      },
    );
    /*
     * `hash` is a dependency and the strike above changes it, so this effect
     * runs a second time — and returns on the latch. That re-run is what
     * releases the first closure, and with it the only reference to the token
     * that outlives the request itself.
     */
  }, [client, navigate, hash]);

  return status;
};
