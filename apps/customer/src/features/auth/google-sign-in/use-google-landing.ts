import {
  FEDERATED_PROVIDERS,
  isErrorCode,
  type ErrorCode,
  type FederatedProvider,
} from "@repo/contracts";
import {
  useNavigate,
  useRouterState,
  type HistoryState,
} from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { useApiClient, useSession } from "@/shared/api/context";

import { takeRedirect } from "./redirect-memory";

/**
 * What the `/auth/google` screen has to say while it says it (ADR-0072 §2,
 * §4).
 *
 * `/verify-email`'s four states, because the screen is that screen's twin —
 * both spend a single-use credential that arrived in a URL fragment and
 * answer login's body — and two of its own, because Google's callback lands
 * here with three kinds of fragment rather than one:
 *
 * - `#token=…` — a sign-in to finish: `pending` while it is exchanged, or
 *   `signedIn` when this browser already holds a session and must be asked
 *   first; success is a navigation home, so it is not a state.
 * - `#linked=google` — a link finished (§3): `linking` for the instant it
 *   takes to move on to the security section.
 * - `#error=<code>` — the callback refused: `failed`, rendering the
 *   catalogue's sentence for the code — or, in a browser that holds a
 *   session, `returning` for the instant it takes to carry the code to the
 *   security section, because the only flow a signed-in browser reaches the
 *   callback from is a link (§4, amended after `D19.3`).
 *
 * `refused` is a spent, expired or unbound handoff — the exchange's one
 * indistinguishable `401` — and also the callback's own `UNAUTHENTICATED`,
 * which is the same fact about the same attempt ("that sign-in did not work,
 * try again", §2 as amended at `D19.2`) and must not read as the catalogue's
 * sentence for that code, which is about a *session* having ended. `missing`
 * is an arrival with nothing to finish.
 */
export type GoogleLandingStatus =
  | "pending"
  | "signedIn"
  | "linking"
  | "returning"
  | "refused"
  | "failed"
  | "missing";

/** What the screen renders from. */
export interface GoogleLanding {
  readonly status: GoogleLandingStatus;
  /**
   * The callback's code, on `failed` and nowhere else — or `undefined` there
   * too when the fragment named a code this build has never heard of, which
   * the screen answers with the catalogue's fallback rather than with a raw
   * `SCREAMING_SNAKE` (ADR-0034's degrade rule, one screen along).
   */
  readonly failure: ErrorCode | undefined;
  /**
   * Spends the handoff this screen is holding. Meaningful on `signedIn` and a
   * no-op everywhere else, because everywhere else nothing is held.
   */
  readonly confirm: () => void;
}

declare module "@tanstack/react-router" {
  /**
   * Which provider a link through §3's flow just attached, carried to the
   * security section as history state — the way `awaitingVerification`
   * carries an address to `/verify-email` — so the section can say so on
   * arrival (`D19.5` draws the notice). Not a search param: it is one
   * navigation's memory rather than a location.
   *
   * **A hint, never a fact** (`D19.3`'s `security-reviewer`). The fragment
   * that produces it can be planted — anybody can link a signed-in person to
   * `/auth/google#linked=google` — so whatever reads this must confirm the
   * provider against the identities the server lists before it says a link
   * happened.
   */
  interface HistoryState {
    identityLinked?: { readonly provider: FederatedProvider };
    /**
     * A link the callback refused, carried to the security section as the
     * code it sent (§4, amended after `D19.3`) and rendered there as the
     * catalogue's sentence for it. Plantable like the hint above, and
     * harmless for the reason it is only ever words: nothing is read from it
     * but which sentence to show, and an unknown code shows the fallback.
     */
    identityLinkRefused?: { readonly code: string };
  }
}

/** A refused link's code, as a navigation to the security section carries it. */
export const identityLinkRefused = (
  code: string,
): HistoryState & {
  readonly identityLinkRefused: { readonly code: string };
} => ({ identityLinkRefused: { code } });

/** What a navigation to the security section spreads into its `state`. */
export const identityLinked = (
  provider: FederatedProvider,
): HistoryState & {
  readonly identityLinked: { readonly provider: FederatedProvider };
} => ({ identityLinked: { provider } });

const isFederatedProvider = (value: string): value is FederatedProvider =>
  (FEDERATED_PROVIDERS as readonly string[]).includes(value);

type Fragment =
  | { readonly kind: "token"; readonly token: string }
  | { readonly kind: "error"; readonly code: string }
  | { readonly kind: "linked"; readonly provider: FederatedProvider }
  | { readonly kind: "none" };

/**
 * Reads the callback's fragment, as ADR-0072 §2 spells it.
 *
 * `URLSearchParams` for `useVerifyEmail`'s reason: the token is opaque and a
 * value that ever grew a `=` would be truncated by anything hand-rolled. The
 * callback puts exactly one parameter in the fragment, and the order below is
 * which one wins if a hand-edited address carries several — the credential
 * first, so a pasted `#token=…&error=…` is not a way to hide one.
 */
const readFragment = (hash: string): Fragment => {
  const params = new URLSearchParams(hash);
  const token = params.get("token");

  if (token !== null && token !== "") return { kind: "token", token };

  const code = params.get("error");

  if (code !== null && code !== "") return { kind: "error", code };

  const provider = params.get("linked");

  if (provider !== null && isFederatedProvider(provider))
    return { kind: "linked", provider };

  return { kind: "none" };
};

/**
 * The status an arrival starts in, from facts read once at mount.
 *
 * No setState happens in the effect below — `react-hooks/set-state-in-effect`
 * refuses one — so every state a person can see on arrival is decided here,
 * and the effect only acts.
 */
const initialStatus = (
  fragment: Fragment,
  signedIn: boolean,
): GoogleLandingStatus => {
  switch (fragment.kind) {
    case "token":
      return signedIn ? "signedIn" : "pending";
    case "error":
      if (signedIn) return "returning";

      return fragment.code === "UNAUTHENTICATED" ? "refused" : "failed";
    case "linked":
      return "linking";
    case "none":
      return "missing";
  }
};

/**
 * Turns Google's callback into whatever it was for (ADR-0072 §2, §4).
 *
 * **`useVerifyEmail`'s twin, and each of its properties is here for the same
 * reason** — read that hook for the long form:
 *
 * - The exchange goes through `@repo/api-client`'s `exchangeGoogleSignIn`, so
 *   the session store keeps its single writer (ADR-0033). That call travels
 *   **with this browser's cookies**, as every call on the client does, and it
 *   must: the callback bound the handoff to this browser with a cookie on the
 *   API's origin (§2 as amended at `D19.2`), and without it every sign-in
 *   answers `401`.
 * - The fragment is struck from the address as soon as it has been read,
 *   `replace` so Back cannot walk to it. A handoff lives sixty seconds, and a
 *   refused exchange deliberately spends nothing.
 * - A browser that already holds a session is **asked before the handoff is
 *   spent** — ADR-0071 §3's `D18.4` rule, which §2 inherits whole: a client
 *   that spends a fragment on mount is a forced-login primitive. The binding
 *   narrows who could hold such a link to this very browser, and the rule is
 *   kept anyway, because the record keeps it and because "the account Google
 *   chose" may not be the one this person thinks they are in.
 * - The token lives in the effect's closure, or — on the `signedIn` branch —
 *   in a ref until somebody clicks; never in state, never rendered.
 * - A ref latches the attempt, because `StrictMode` double-invokes effects
 *   and a second exchange of the same token is a `401` over a session this
 *   screen just made.
 */
export const useGoogleLanding = (): GoogleLanding => {
  const client = useApiClient();
  const navigate = useNavigate();
  const session = useSession();
  const hash = useRouterState({ select: (state) => state.location.hash });

  /*
   * Read once, at mount, and without the token: the arrival's *kind* and, for
   * a refusal, its code — neither is a credential. The live hash is read again
   * in the effect, which is the only place the token itself is taken.
   */
  const [arrival] = useState(() => {
    const fragment = readFragment(hash);

    return {
      fragment:
        fragment.kind === "token" ? { kind: "token" as const } : fragment,
      status: initialStatus(fragment, session.isAuthenticated),
    };
  });
  const [status, setStatus] = useState<GoogleLandingStatus>(arrival.status);
  const attempted = useRef(false);
  /**
   * The handoff waiting for a click, and where it lands, on the `signedIn`
   * branch and nowhere else.
   */
  const held = useRef<
    | { readonly token: string; readonly destination: string | undefined }
    | undefined
  >(undefined);

  const spend = useCallback(
    (token: string, destination: string | undefined) => {
      held.current = undefined;

      client.exchangeGoogleSignIn(token).then(
        () => {
          /*
           * `replace` so Back does not land on a screen whose job is done —
           * the `/verify-email` landing. **Where the sign-in screen was
           * sending the person, when it was sending them anywhere** (ADR-0072
           * §4, amended after `D19.3`): the location "Continue with Google"
           * remembered before leaving, taken once and fenced to a path on this
           * origin by `takeRedirect`; home otherwise. Never a value from the
           * fragment, which an attacker's link could set.
           */
          const landing =
            destination === undefined
              ? navigate({ to: "/", replace: true })
              : navigate({ href: destination, replace: true });

          void landing.catch(() => undefined);
        },
        () => {
          setStatus("refused");
        },
      );
    },
    [client, navigate],
  );

  const signedIn = arrival.status === "signedIn";
  /** A refusal read at mount in a browser that held a session (§4). */
  const returning = arrival.status === "returning";

  useEffect(() => {
    if (attempted.current) return;

    /*
     * Latched on the **first** run, whatever the fragment held (`D19.3`'s
     * `security-reviewer`). One mount acts on the arrival it read and on
     * nothing after it: an arrival with nothing in the fragment that later
     * gained `#token=…` without a reload — pasted into the bar, or set by
     * whatever page opened this tab, which is a same-document navigation —
     * would otherwise reach the exchange with `signedIn` computed for the
     * *first* address, and spend the handoff in a browser holding a session
     * without asking. The screen that says "nothing to finish here" stays
     * saying it.
     */
    attempted.current = true;

    const fragment = readFragment(hash);

    if (fragment.kind === "none") return;

    /*
     * A refusal in a browser that holds a session is a **link** that did not
     * happen (§4, amended after `D19.3`): a signed-in browser reaches the
     * callback only from the security section's link start, so the code goes
     * back there as the section's notice, and "sign in again" — the right
     * sentence for a sign-in — is never shown to somebody who is signed in.
     * `replace` takes the fragment-bearing entry out of the history in the
     * same move, as the link branch below does.
     */
    if (fragment.kind === "error" && returning) {
      void navigate({
        to: "/account/security",
        replace: true,
        state: identityLinkRefused(fragment.code),
      }).catch(() => undefined);
      return;
    }

    /*
     * A link lands on the security section, where the new way in is listed
     * (§4). The one navigation, `replace`, which takes the fragment-bearing
     * entry out of the history in the same move — so this branch needs no
     * strike of its own. The `_dashboard` guard stands between here and there,
     * and a browser whose session did not survive the round trip to Google is
     * sent to sign in, which is right: a link needs the account's own session.
     */
    if (fragment.kind === "linked") {
      void navigate({
        to: "/account/security",
        replace: true,
        state: identityLinked(fragment.provider),
      }).catch(() => undefined);
      return;
    }

    // Struck on every other branch before anything else happens.
    void navigate({ to: "/auth/google", hash: "", replace: true }).catch(
      () => undefined,
    );

    if (fragment.kind === "error") return;

    // Taken once, here, beside the token: the latch above makes this the one
    // read, so `StrictMode`'s second run cannot find the value gone.
    const destination = takeRedirect();

    if (signedIn) {
      held.current = { token: fragment.token, destination };
      return;
    }

    spend(fragment.token, destination);
    /*
     * `hash` is a dependency and the strike changes it, so this runs a second
     * time and returns on the latch — which releases the first closure and,
     * with it, the only reference to the token that outlives the request.
     */
  }, [navigate, hash, signedIn, returning, spend]);

  const confirm = useCallback(() => {
    const waiting = held.current;

    if (waiting === undefined) return;

    // An event handler, so the screen may move to `pending` here — which takes
    // the button away before a second click can post a token in flight.
    setStatus("pending");
    spend(waiting.token, waiting.destination);
  }, [spend]);

  const failure =
    status === "failed" &&
    arrival.fragment.kind === "error" &&
    isErrorCode(arrival.fragment.code)
      ? arrival.fragment.code
      : undefined;

  return { status, failure, confirm };
};
