import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { profileKeys } from "@/entities/profile";
import { isApiClientError } from "@/shared/api/api-error";
import { useApiClient } from "@/shared/api/context";

/**
 * What the `/confirm-email` screen has to say while it says it (ADR-0071 §6).
 *
 * Four states, where `/verify-email` has four and `/reset-password` has two,
 * and the shape of the difference is the shape of the flow. This link **is**
 * the action — like a verification link and unlike a recovery link, there is
 * nothing to type — so it is spent on sight and the screen has a `pending` to
 * show while it decides. What it lands on is `confirmed` rather than a
 * navigation, because there is nowhere to send the reader: the endpoint issues
 * no session (§6), and the browser that opened the mail is very often not one
 * that has ever signed in to this account.
 *
 * `taken` is the one state here with no sibling on the other two screens, and
 * it is the one refusal ADR-0071 §6 deliberately makes distinguishable: the
 * uniqueness question is asked again inside the confirming transaction, so an
 * address somebody else claimed in the meantime answers `409
 * USER_EMAIL_TAKEN`. It is not an enumeration leak — whoever holds this link
 * already knows which address it names, because it is the mailbox the message
 * arrived in — and it is the only failure here that a *different* address
 * would fix, so telling the reader is the difference between "try again" and
 * knowing to start over with another one.
 *
 * `refused` covers every other way there is nothing to spend, including no
 * token in the address at all. They are one sentence for `/reset-password`'s
 * reason: nothing in this app sends anybody here empty-handed, so an address
 * with no fragment is a link that lost one, which is the same predicament as a
 * link that has been spent — and the API answers every one of those cases with
 * one indistinguishable `401`.
 *
 * **There is deliberately no "are you sure" gate for a browser that already
 * holds a session**, which `/verify-email` carries since `D18.4`. That gate
 * exists because a verification link *is* a session, so getting a signed-in
 * person to open one moves them into somebody else's account without a
 * password. Nothing here can do that: this endpoint issues no session and
 * revokes none, and what it changes is an address on the account that asked
 * for the change — never on the account the reader happens to be signed into.
 * The worst an unwanted click achieves is completing a change its own owner
 * requested, which is what the link is for. That is the re-reading against
 * §3's amended list this route is required to do rather than inherit.
 */
export type EmailChangeStatus = "pending" | "confirmed" | "taken" | "refused";

/** The fragment's one parameter, as ADR-0071 §1 spells the address. */
const TOKEN_PARAM = "token";

/**
 * Reads the confirmation token out of `#token=…`.
 *
 * `URLSearchParams` rather than a split on `=`, for its two siblings' reason:
 * the token is opaque and its encoding is the mint's business
 * (`accountTokenSchema`'s own comment), so anything hand-rolled would truncate
 * a value that ever grew a `=`.
 */
const tokenFromHash = (hash: string): string | undefined => {
  const token = new URLSearchParams(hash).get(TOKEN_PARAM);

  return token === null || token === "" ? undefined : token;
};

/**
 * Spends an address-change link (ADR-0071 §6).
 *
 * **The fragment is struck from the address as soon as it has been read**, on
 * every branch, for the reason both siblings strike theirs: a refused
 * consumption spends nothing (§1), so a link refused because the account was
 * disabled for an afternoon is still redeemable for the rest of its hour while
 * sitting in the address bar, the session history and any `Referer` the page
 * emits. `replace` rather than a push, so Back cannot walk to the entry that
 * carried it.
 *
 * **Nothing durable holds the credential.** Unlike `/reset-password` there is
 * nothing to wait for — no password to type — so the token lives only in the
 * effect's closure and is released when the request settles. The ref here
 * latches the *attempt*, not the value: `StrictMode` double-invokes effects in
 * development, and the second invocation would post the same token again and
 * be answered `401` on a link that had just worked.
 *
 * **On success the profile query is invalidated**, which is the smallest
 * honest thing this screen can do about a browser that is signed into the
 * account that just moved: the account screens read the address from
 * `GET /user/profile`, so they are correct on the next render. The residual is
 * the header's account control, which reads the *session* principal
 * (ADR-0033) — and this endpoint answers no principal to rebuild one from,
 * because it issues no session. It self-heals at the next access-token
 * rotation or reload, and the ordinary case does not arise at all: this link
 * is opened wherever the new mailbox is read.
 */
export const useConfirmEmail = (): EmailChangeStatus => {
  const client = useApiClient();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hash = useRouterState({ select: (state) => state.location.hash });

  /*
   * A boolean, not the value. The initializer runs on the first render only,
   * so this answers "did a link arrive" about the *arriving* address rather
   * than about whatever the bar holds after the effect empties it — and it
   * answers it without retaining the credential to do so.
   */
  const [arrived] = useState(() => tokenFromHash(hash) !== undefined);
  const [status, setStatus] = useState<EmailChangeStatus>(
    arrived ? "pending" : "refused",
  );
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;

    const token = tokenFromHash(hash);

    if (token === undefined) return;

    attempted.current = true;

    // `.catch` because TanStack rejects a navigation that is cancelled, and an
    // unhandled rejection out of a replace would be noise nobody can act on.
    void navigate({ to: "/confirm-email", hash: "", replace: true }).catch(
      () => undefined,
    );

    client.confirmEmail(token).then(
      () => {
        void queryClient.invalidateQueries({ queryKey: profileKeys.all });
        setStatus("confirmed");
      },
      (error: unknown) => {
        // The one refusal worth its own sentence (ADR-0071 §6). Everything
        // else — the `401` in all its forms, an unreachable API — is the same
        // dead-link screen, because none of them is something the reader can
        // act on differently.
        setStatus(
          isApiClientError(error) && error.status === 409 ? "taken" : "refused",
        );
      },
    );
  }, [client, hash, navigate, queryClient]);

  return status;
};
