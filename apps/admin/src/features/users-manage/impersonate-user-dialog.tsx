import type { UserResource } from "@repo/contracts";
import { useEffect, useRef, useState } from "react";

import { useImpersonateUser } from "@/entities/user";
import { config } from "@/shared/config";
import { useT } from "@/shared/i18n";
import { ConfirmDialog } from "@/shared/ui";

/**
 * The customer app's address for a minted handoff (ADR-0057 §2, §7).
 *
 * **The token travels in the fragment and only there.** A query parameter would
 * put a live credential in the customer app's server logs, in any `Referer` the
 * next navigation sends, and in whatever a reverse proxy records; a fragment is
 * never transmitted. `URLSearchParams` builds it rather than a template
 * literal, because the token is opaque — `randomToken(32)` is base64url today
 * and the encoding is the mint's business — and this is the exact shape
 * `useRedeemHandoff` reads on the other side (`new URLSearchParams(hash)`).
 *
 * `new URL("/impersonate", origin)` rather than string concatenation: it
 * absorbs a trailing slash on the configured origin instead of producing
 * `//impersonate`, and it throws on a value that is not a URL — which the
 * config schema has already refused at module load anyway.
 *
 * Exported for the suite and not through the feature's barrel: the assertion
 * this step's done-when names is about this string, and rebuilding it in the
 * test would be asserting a second copy — but no layer above this slice has any
 * business with the address, so the public API does not grow for it.
 */
export const handoffUrl = (token: string): string => {
  const url = new URL("/impersonate", config.VITE_CUSTOMER_APP_URL);

  url.hash = new URLSearchParams({ token }).toString();

  return url.toString();
};

/**
 * "Open the customer app as this person?" (`D13.8`, ADR-0057 §7).
 *
 * The confirm exists for the same reason the delete confirm does — the action
 * is not undoable in the sense that matters, because a mint is an audited event
 * with the operator's name on it the moment it happens (ADR-0058) — and the
 * description is where the operator learns the three things that are *not*
 * obvious: that their own admin session is untouched, that the excluded
 * operations will be refused, and that everything they do is attributed to both
 * identities. None of that is discoverable from the button.
 *
 * **Not `destructive`.** Nothing is destroyed and the red confirm is the app's
 * word for that; overloading it here would make it mean "serious", which is a
 * different thing and one every remaining red button would then have to share.
 * The weight this action deserves is carried by the sentences, which is where a
 * warning that can be read belongs.
 *
 * **The customer app opens in a tab of its own, and the tab is opened on the
 * click** (ADR-0070 §1, a delta on ADR-0057 §7). The panel staying on screen is
 * the point: the reason impersonation exists is to see what a customer sees
 * while holding what the panel knows about them, and a same-tab navigation
 * makes those two views alternate rather than sit side by side.
 *
 * **The order is the decision, not an implementation detail.** `window.open`
 * runs *synchronously inside the click*, where the transient activation is, so
 * no popup blocker can refuse it; the mint still follows the confirm, which is
 * where ADR-0057 §1 put it; and the blank tab is navigated only when the answer
 * arrives. Opening *after* the awaited round trip is the case ADR-0057 §7
 * rejected, and rejected correctly — the activation may be spent by then and a
 * blocked open is *silent*, leaving the operator with a success toast, no tab
 * and a sixty-second credential they can neither spend nor see.
 *
 * **The opener is disowned before the tab is navigated** (ADR-0070 §2). At that
 * moment the tab is `about:blank` and same-origin, so the write is permitted,
 * and a disowned browsing context stays disowned across the navigation that
 * follows. Production's `Cross-Origin-Opener-Policy: same-origin` on the admin
 * origin severs it a second time — and neither replaces the other: the header
 * is a property of one deployment's static server, which the dev server does
 * not send, while this write is a property of the code every deployment runs.
 * The customer app is not asked to check; a page cannot make its own opener
 * less trusted than it arrives.
 *
 * **A refused open falls back to this tab** (ADR-0070 §3). `window.open`
 * answers `null` when a browser refuses even a click-initiated open — an
 * extension, a policy, a kiosk profile — and the fallback is the behaviour this
 * record replaces: navigate `_self`, mint still after the confirm. The operator
 * loses the panel and keeps the credential, which is the right way round; a
 * toast reading "allow pop-ups" is the wrong way round, because by the time
 * anything could be said the mint has already spent a budget entry and minted a
 * live credential.
 *
 * **`window.open(…, "_self")` rather than `location.assign` in that fallback,
 * and the reason is worth stating because the two are the same navigation.**
 * `_self` targets the browsing context that already exists, so no popup
 * heuristic applies — blocking is about *creating* a context — and unlike
 * `Location`'s members, which are `[LegacyUnforgeable]` and therefore
 * non-configurable in a browser and in jsdom alike, this is an ordinary method
 * the suite can observe. The alternative was a one-line indirection module
 * mocked in the tests, which this harness deliberately avoids
 * (`test/render.tsx`: "no `vi.mock`") and which would be a second
 * implementation of "go there" that production never runs. The *new* tab is
 * navigated through its own `location`, which is a handle this code was given
 * rather than the one it lives in — nothing unforgeable about it.
 *
 * **A refused mint closes the tab it opened** and leaves the confirm open with
 * its toast, which is `ConfirmDialog`'s contract. A blank tab left behind a
 * refusal would be the operator's only evidence that anything happened, and the
 * sentence is the better one.
 *
 * **The confirm refuses a second press between the open and the navigation, and
 * that is not cosmetic.** A settled mutation re-enables its own button, so
 * without `leaving` the operator could press Impersonate again — spending a
 * second request against ADR-0057 §1's per-actor budget (which the caller here
 * is an `admin` and therefore really does spend) and minting a second live
 * credential with a second `impersonation.minted` audit row against their name.
 * On the fallback path that interval is the life of this document, exactly as
 * before; on the new-tab path it ends when the dialog closes.
 *
 * It goes through `confirmDisabled` rather than `isPending`, which is the prop
 * that grew for it. `isPending` also locks Cancel, Escape and the backdrop, on
 * the argument that a request in flight lands either way — true of a request
 * and not of a navigation. **A refusal lifts the latch**, because nothing is
 * leaving after one: borrowing `isPending` here would leave an operator whose
 * mint was refused in a modal with a dead confirm and no exit but Cancel.
 *
 * **And the mutation is reset once the token has been spent**, which is
 * `CREDENTIAL_MUTATION` finishing its own job. `gcTime: 0` evicts a mutation
 * when its last observer goes, and on the fallback path this observer does
 * *not* go — the dialog stays mounted through the navigation on purpose — so
 * the handoff would sit in `getMutationCache()` for as long as the document
 * survived. In a browser that is a moment; in a browser where the navigation is
 * refused by an extension it is indefinite. Resetting makes the narrow window a
 * property rather than a consequence of the page going away.
 */
export const ImpersonateUserDialog = ({
  user,
  onClose,
}: {
  readonly user: UserResource;
  readonly onClose: () => void;
}) => {
  const { t } = useT("users");
  const impersonate = useImpersonateUser();
  const [leaving, setLeaving] = useState(false);

  /*
   * The tab this dialog opened and has not yet handed anything to.
   *
   * TanStack Query does not run a `mutate`-scoped callback whose observer has
   * gone, so a dialog unmounted while the mint is in flight — Back, on a route
   * change the backdrop does not block — gets neither `onSuccess` nor
   * `onError`, and the blank tab would outlive the panel that opened it with
   * nothing in it and no way back to it (`D17.2`, code review). The ref is
   * cleared the moment the handle is either handed over or closed, so this
   * cleanup can only ever find a tab nothing was done with.
   */
  const unhandedTab = useRef<Window | null>(null);

  useEffect(
    () => () => {
      unhandedTab.current?.close();
    },
    [],
  );

  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("impersonate.title", { email: user.email })}
      description={t("impersonate.description")}
      confirmLabel={t("impersonate.confirm")}
      isPending={impersonate.isPending}
      confirmDisabled={leaving}
      onConfirm={() => {
        /*
         * Inside the click and before the mint (ADR-0070 §1) — an empty URL,
         * because the address does not exist yet, so the tab sits on
         * `about:blank` and same-origin until the answer arrives. `_blank`
         * rather than a name: a named target would be reused across mints,
         * which the production Cross-Origin-Opener-Policy defeats anyway, and
         * §4 of the record answers the one-impersonation-per-browser question
         * on the API side instead.
         */
        const tab = window.open("", "_blank");

        unhandedTab.current = tab;
        setLeaving(true);

        impersonate.mutate(user.id, {
          onSuccess: ({ token }) => {
            /*
             * One address, built before either path takes it, so the tab and
             * the fallback cannot be sent to different strings. A throw here
             * would leave the blank tab standing and the latch down — which is
             * worth knowing is unreachable rather than guarding: the config
             * schema refuses a `VITE_CUSTOMER_APP_URL` that is not a URL at
             * module load, so `new URL(…)` has nothing left to reject.
             */
            const url = handoffUrl(token);

            /*
             * No tab to hand it to, so this document takes it (ADR-0070 §3) —
             * `D13.8`'s behaviour unchanged, and no `onClose()` first, because
             * closing the dialog would flash the grid behind it for the
             * duration of a navigation.
             *
             * **`closed` is half of that test and not a flourish** (security
             * review). `null` is only the refusal a blocker gives; a tab the
             * operator shut during the round trip, or one an extension opened
             * and closed again, is a live handle on a discarded browsing
             * context, and writing to it is a no-op in every engine that does
             * not throw. Without this the step would end in the one outcome
             * §3 exists to prevent: a spent budget entry, an
             * `impersonation.minted` row against the operator's name, a live
             * sixty-second credential, a closed dialog — and no tab, no toast
             * and nothing said.
             */
            if (tab === null || tab.closed) {
              unhandedTab.current = null;
              window.open(url, "_self");
              impersonate.reset();

              return;
            }

            try {
              tab.opener = null;
              tab.location.href = url;
              unhandedTab.current = null;
            } finally {
              /*
               * After the handover, never before it: `reset()` clears the
               * mutation's `data`, and the token is read out of it above. In
               * a `finally` because the two lines above touch a foreign
               * `WindowProxy` — a context discarded between the `closed` test
               * and the write throws a dead-object `TypeError` in at least one
               * engine, and a throw that skipped the reset would leave the
               * live handoff in `getMutationCache()` for as long as the dialog
               * stayed mounted, which is the window `CREDENTIAL_MUTATION`
               * exists to close.
               */
              impersonate.reset();
            }

            // The panel stays, so the dialog has no reason to: `D13.8`'s "no
            // `onClose()` first" was about a document that was leaving.
            onClose();
          },
          onError: () => {
            unhandedTab.current = null;
            tab?.close();
            setLeaving(false);
          },
        });
      }}
    />
  );
};
