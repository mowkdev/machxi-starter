import type { InvitationLookupResource } from "@repo/contracts";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAcceptInvitationByToken } from "@/entities/organization";
import { isApiClientError } from "@/shared/api/api-error";
import { useApiClient, useSession } from "@/shared/api/context";
import { useMessageForError } from "@/shared/notifications/messages";

/**
 * What the `/invitations/accept` screen has to say while it says it
 * (ADR-0071 §5).
 *
 * **Six states, and three of them are the same fact seen from three
 * sessions.** Once the link has been read there is one offer — an
 * organization, an address and a role — and what the screen can *do* with it
 * depends entirely on who is holding the browser: nobody (`stranger`), the
 * person it was sent to (`holder`), or somebody else (`mismatch`). That is the
 * three landings the step asks for, and they are deliberately not three
 * screens: the offer is the same sentence in all three, and only the way
 * forward differs.
 *
 * `refused` covers **both** ways there is nothing to act on — no token in the
 * address, and a token the API would not read — for `useResetPassword`'s
 * reason. Nothing in this app sends anybody to this address empty-handed, so a
 * link that lost its fragment is in the same predicament as one that has been
 * withdrawn; and the API answers unknown, accepted, declined, revoked, expired
 * and organization-deleted with one indistinguishable `404` (ADR-0071 §5), so
 * a client offering a sharper story would be inventing a distinction the
 * server declines to make.
 *
 * **`unavailable` is what `refused` must not swallow** (`D18.8`, both
 * reviewers). The lookup carries a limiter keyed on the caller's source alone,
 * which behind one office egress is everybody there, so a `429` — or a dropped
 * connection — is an ordinary answer about a perfectly live invitation. Told
 * "this link cannot be used, ask for a new one", a reader would go and have
 * the only working link revoked and replaced; and because the fragment has
 * already been struck, they could not retry from this tab either. So the link
 * is kept, the screen says the check failed, and it offers to ask again.
 */
export type InvitationLinkStatus =
  "pending" | "refused" | "unavailable" | "stranger" | "holder" | "mismatch";

/** What the screen renders from. */
export interface InvitationLink {
  readonly status: InvitationLinkStatus;
  /**
   * The organization, the invited address and the role — present on the three
   * states that have read the link, and `undefined` on the two that have not.
   *
   * No invitation id, because the answer carries none: an id would be
   * authority for the *other* accept path, the one scoped by address alone
   * (ADR-0071 §5), and holding the token is not that authority.
   */
  readonly offer: InvitationLookupResource | undefined;
  /** The address this browser is signed in as, for the `mismatch` sentence. */
  readonly signedInAs: string | undefined;
  /** True while the acceptance is in flight. */
  readonly joining: boolean;
  /**
   * The catalogue sentence for a refusal that is **not** the link's own — the
   * route's budget answering `429`, an unreachable API (ADR-0034's code map).
   */
  readonly formError: string | null;
  /** Spends the held link on the signed-in account. */
  readonly accept: () => void;
  /**
   * Asks the lookup again, on `unavailable` and nowhere else.
   *
   * A no-op with no link in hand, which is the same guard `accept` carries:
   * they are the only two ways a screen with no credential could ask for one.
   */
  readonly retry: () => void;
}

/** The fragment's one parameter, as ADR-0071 §1 spells the address. */
const TOKEN_PARAM = "token";

/**
 * Reads the invitation token out of `#token=…`.
 *
 * `URLSearchParams` rather than a split on `=`, for `useVerifyEmail`'s reason:
 * the token is opaque, its encoding is the mint's business, and a value that
 * ever grew a `=` would be truncated by anything hand-rolled. An empty or
 * absent parameter is `undefined` rather than `""`, so "no link" and "an empty
 * link" are one state.
 */
const tokenFromHash = (hash: string): string | undefined => {
  const token = new URLSearchParams(hash).get(TOKEN_PARAM);

  return token === null || token === "" ? undefined : token;
};

/**
 * Turns an invitation link into an offer, and — for the person it was sent
 * to — into a membership (ADR-0071 §5).
 *
 * **The third fragment-spending hook in this app, and the one that reads
 * before it writes.** `useVerifyEmail` spends its link on sight and
 * `useResetPassword` opens a form with it; this one *looks the link up* first,
 * because the whole point of the screen is to say what is being offered and by
 * whom before anybody joins anything. The lookup is unauthenticated and
 * consumes nothing, so asking is free and asking twice is harmless.
 *
 * **The fragment is struck from the address as soon as it has been read**, and
 * here the window it protects is the widest of the three: the token is not
 * spent by arriving, so without the strike it would sit in the address bar for
 * as long as somebody takes to read an offer and decide — in the session
 * history, in whatever a screen-share is showing, and in a `Referer` the
 * moment anything on the page loads a third-party asset. `replace` rather than
 * a push, so Back cannot walk to the entry that carried it.
 *
 * **The credential waits in a ref, never in state and never in the DOM**, for
 * `useResetPassword`'s reason exactly: it has to survive until somebody acts,
 * and a ref is what survives without being rendered, persisted or handed to
 * React DevTools. It is cleared the moment the link is spent or refused, and
 * it goes with the screen.
 *
 * **It is not in a query key either, and that is deliberate.** The lookup is a
 * read and `@tanstack/react-query` would happily cache it — but a query key is
 * a durable, inspectable, serialisable structure, and putting a single-use
 * bearer credential into one would leave it in the cache long after the screen
 * that held it. So the lookup is imperative, exactly as `verifyEmail`'s
 * exchange is; the *acceptance* is a mutation, because a mutation's key is its
 * own and what it invalidates is the entity's business (ADR-0043).
 *
 * **There is no "are you sure" gate for a browser that already holds a
 * session**, which `/verify-email` grew at `D18.4`. That gate exists because a
 * verification link *is* a session — an attacker who gets a signed-in person
 * to open one has moved them into an account without a password being typed.
 * Nothing here can do that: this link issues no session, it can only add a
 * membership to the account already in the browser, and it can only do that
 * when the address matches — so the worst an unwanted click achieves is
 * joining an organization one was genuinely invited to, from an account one
 * genuinely controls. Acceptance is a button in every case, so even that is
 * something a person did rather than something a link did to them.
 */
export const useInvitationLink = (): InvitationLink => {
  const client = useApiClient();
  const navigate = useNavigate();
  const messageForError = useMessageForError();
  /*
   * Destructured, because `useMutation` hands back a fresh object every render
   * and `mutate` is the one stable reference on it — so `accept` below is
   * built once rather than on every keystroke elsewhere in the tree.
   */
  const { mutate: acceptByToken, isPending: joining } =
    useAcceptInvitationByToken();
  /*
   * Read live rather than latched at mount, which is `useVerifyEmail`'s
   * opposite and for the reason that hook gives for latching: there the
   * exchange *replaces* the session, so a live read would answer about the
   * session the screen had just created. Nothing here touches the session at
   * all, so the truthful answer to "who is holding this browser" is the
   * current one — and the boot gate (ADR-0033 §Boot) means a hydrated store
   * has both a token and a principal by the time this renders, so a null
   * principal is an anonymous visitor rather than a half-booted one.
   */
  const { principal } = useSession();
  const hash = useRouterState({ select: (state) => state.location.hash });

  /*
   * A boolean, not the value. The initializer runs on the first render only,
   * so this answers "did a link arrive" about the *arriving* address rather
   * than about whatever the bar holds after the effect empties it — and it
   * answers it without retaining the credential to do so.
   */
  const [arrived] = useState(() => tokenFromHash(hash) !== undefined);
  const [read, setRead] = useState<
    "pending" | "refused" | "unavailable" | "ready"
  >(arrived ? "pending" : "refused");
  const [offer, setOffer] = useState<InvitationLookupResource | undefined>(
    undefined,
  );
  const [formError, setFormError] = useState<string | null>(null);
  /** The link this screen is holding, until it is spent or refused. */
  const held = useRef<string | undefined>(undefined);
  /**
   * The token the lookup has already been asked about.
   *
   * A latch on the **value** rather than on the mount, which is what makes it
   * right in both directions. `StrictMode` double-invokes effects in
   * development and the strike below is asynchronous, so the second invocation
   * arrives with the same fragment still in hand and would ask a second time —
   * spending a second request of the route's budget for one arrival. And a
   * *different* token pasted into a tab already sitting here must be looked
   * up: a fragment-only change reloads no document, so a mount-latch would
   * leave the new link unread and, worse, unstruck (`D18.6`'s finding on
   * `/reset-password`).
   */
  const requested = useRef<string | undefined>(undefined);

  /**
   * Asks what a token is offering, and pairs the answer with the token.
   *
   * **Both arms return early unless the token they answer for is still the one
   * this screen is about** (`D18.8`, both reviewers). Two lookups can be in
   * flight after a second link arrives on an open tab, and they can settle in
   * either order — so an unguarded arm can leave the card naming organization
   * A beside a button that spends B's token, or wipe a live link because a
   * slow `404` for an abandoned one came back last.
   */
  const lookup = useCallback(
    (token: string) => {
      client.lookupInvitation(token).then(
        (found) => {
          if (requested.current !== token) return;

          setOffer(found);
          setRead("ready");
          setFormError(null);
        },
        (error: unknown) => {
          if (requested.current !== token) return;

          /*
           * **Only a `404` is a dead link** (`D18.8`, both reviewers), and the
           * first version said every failure was one. `lookup` carries
           * ADR-0020's numbers keyed on the **source alone**, which behind an
           * office NAT is everybody there, so a `429` is an ordinary answer
           * for a perfectly live invitation — and the sentence this screen
           * prints for a dead link tells the reader to ask for a new one,
           * which is revoke-and-create and would destroy the link they are
           * holding. The fragment has already been struck, so that advice is
           * unrecoverable from this tab. `accept`'s own arm below always got
           * this right; this one now matches it.
           */
          if (isApiClientError(error) && error.status === 404) {
            held.current = undefined;
            setOffer(undefined);
            setRead("refused");
            return;
          }

          // The link is kept and the screen offers to ask again, because the
          // failure is about the request rather than about the invitation.
          setFormError(messageForError(error));
          setRead("unavailable");
        },
      );
    },
    [client, messageForError],
  );

  useEffect(() => {
    const token = tokenFromHash(hash);

    if (token === undefined) return;

    /*
     * **The strike runs before the latch is consulted, not after** (`D18.8`,
     * `code-reviewer`). Re-opening the *same* link on a tab already sitting
     * here is a fragment-only navigation that reloads no document, so an early
     * return above this line would leave `#token=…` in the address bar, in the
     * session history and in any `Referer` — the one thing the strike exists
     * to prevent, and `D18.6`'s finding on `/reset-password` one token-value
     * along.
     */
    const asked = requested.current === token;

    requested.current = token;

    /*
     * `.then`'s two arms rather than a bare `.catch`: TanStack rejects a
     * navigation that is cancelled, and an unhandled rejection out of a
     * replace would be noise nobody can act on. The fulfilled arm is where the
     * work happens, and that is deliberate — `react-hooks/set-state-in-effect`
     * refuses a synchronous setState in an effect body, and this screen has to
     * be **reset** before the new token becomes the held one.
     */
    void navigate({ to: "/invitations/accept", hash: "", replace: true }).then(
      () => {
        if (asked) return;

        /*
         * **The offer on screen and the token in hand always name the same
         * invitation** (`D18.8`, `security-reviewer`). `held.current` moves
         * here rather than in the effect body, beside the reset that takes the
         * previous offer down — so there is no render in which the card
         * describes organization A while Accept would join B.
         */
        held.current = token;
        setOffer(undefined);
        setRead("pending");
        setFormError(null);
        lookup(token);
      },
      () => undefined,
    );
  }, [hash, lookup, navigate]);

  /** Asks again after a failure that was about the request, not the link. */
  const retry = useCallback(() => {
    const token = held.current;

    if (token === undefined) {
      setRead("refused");
      return;
    }

    setFormError(null);
    setRead("pending");
    lookup(token);
  }, [lookup]);

  const accept = useCallback(() => {
    const token = held.current;

    if (token === undefined) {
      setRead("refused");
      return;
    }

    setFormError(null);

    acceptByToken(token, {
      onSuccess: (organization) => {
        held.current = undefined;
        /*
         * Into the organization that was just joined, which is what "accept
         * and land in the organization" means — the switcher's list has been
         * invalidated by the entity hook, so the shell names the new context
         * on arrival. `replace`, so Back cannot return to a screen holding a
         * link that has now been spent.
         */
        void navigate({
          to: "/orgs/$orgSlug",
          params: { orgSlug: organization.slug },
          replace: true,
        }).catch(() => undefined);
      },
      onError: (error: unknown) => {
        /*
         * The one refusal with a screen of its own. The offer is gone —
         * withdrawn, expired, or taken while this screen sat open — which is
         * the same `404` the lookup answers and therefore the same sentence.
         */
        if (isApiClientError(error) && error.status === 404) {
          held.current = undefined;
          setOffer(undefined);
          setRead("refused");
          return;
        }

        /*
         * Everything else keeps the offer on screen and says why through
         * ADR-0034's code map, never from the API's own `message` (ADR-0013).
         * Two of them are worth naming. The route's budget answering `429` is
         * the ordinary one, and trying again in a moment is exactly the right
         * thing to do. The other is a `403` address mismatch, which can only
         * mean the session changed under the reader — another tab signed out
         * and in as somebody else — and whose catalogue sentence says exactly
         * that. The link is deliberately **not** released on either: a refused
         * acceptance spends nothing (ADR-0071 §1), so it still works for
         * whoever it was sent to.
         */
        setFormError(messageForError(error));
      },
    });
  }, [acceptByToken, messageForError, navigate]);

  /*
   * Derived rather than stored, which is what keeps "who is holding this
   * browser" a live question: somebody who signs in from another tab and comes
   * back finds the offer they can now take rather than the sentence a stale
   * snapshot left behind.
   *
   * **The addresses are compared raw**, which is the service's own decision
   * (`D18.7`'s `security-reviewer`) reaching the client: both values were
   * normalised by `emailSchema` before either was stored, so equality is the
   * honest statement of that invariant, and a `toLowerCase()` on top would
   * fold pairs the unique index holds apart. Here the comparison decides only
   * whether a *button* is drawn — the API re-checks it and is the authority —
   * so a disagreement costs a person one sentence telling them to sign in as
   * the invited address, and never a membership granted to a near miss.
   */
  const status: InvitationLinkStatus =
    read === "pending" || read === "unavailable"
      ? read
      : read === "refused" || offer === undefined
        ? "refused"
        : principal === null
          ? "stranger"
          : principal.email === offer.email
            ? "holder"
            : "mismatch";

  return {
    status,
    offer,
    signedInAs: principal?.email,
    joining,
    formError,
    accept,
    retry,
  };
};
