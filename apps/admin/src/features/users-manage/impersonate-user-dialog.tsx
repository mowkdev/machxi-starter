import type { UserResource } from "@repo/contracts";
import { useState } from "react";

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
 * **The navigation is this tab, not a second one**, and that is a decision
 * rather than a shortcut — see the amendment at ADR-0057 §7. Opening a new tab
 * after an awaited round trip is the classic popup-blocker case: the click's
 * transient activation may be spent by the time the mint answers, and a blocked
 * open is *silent* — the operator would be left with a success, no tab, and a
 * sixty-second credential they can neither spend nor see. A same-tab
 * navigation cannot be blocked, needs no window handle, and leaves no
 * `window.opener` on the customer origin. The admin panel is one entry back in
 * history and the operator's staff session is still live there, which is the
 * whole point of the mint setting no cookies.
 *
 * **`window.open(…, "_self")` rather than `location.assign`, and the reason is
 * worth stating because the two are the same navigation.** `_self` targets the
 * browsing context that already exists, so no popup heuristic applies —
 * blocking is about *creating* a context — and unlike `Location`'s members,
 * which are `[LegacyUnforgeable]` and therefore non-configurable in a browser
 * and in jsdom alike, this is an ordinary method the suite can observe. The
 * alternative was a one-line indirection module mocked in the tests, which this
 * harness deliberately avoids (`test/render.tsx`: "no `vi.mock`") and which
 * would be a second implementation of "go there" that production never runs.
 *
 * **The confirm refuses a second press after the mint succeeds, and that is
 * not cosmetic.** A navigation is not instant, and a settled mutation
 * re-enables its own button — so without `leaving` the operator could press
 * Impersonate again while the browser is on its way, spending a second request
 * against ADR-0057 §1's per-actor budget (which the caller here is an `admin`
 * and therefore really does spend) and minting a second live credential with a
 * second `impersonation.minted` audit row against their name.
 *
 * It goes through `confirmDisabled` rather than `isPending`, which is the prop
 * that grew for it. `isPending` also locks Cancel, Escape and the backdrop,
 * on the argument that a request in flight lands either way — true of a
 * request and not of a navigation. `leaving` is never cleared, so borrowing
 * `isPending` would mean that a navigation which somehow does not happen
 * leaves the operator in a modal with no exit but a reload.
 *
 * **And the mutation is reset once the token has been spent**, which is
 * `CREDENTIAL_MUTATION` finishing its own job. `gcTime: 0` evicts a mutation
 * when its last observer goes, and this observer does *not* go on success —
 * the dialog stays mounted through the navigation on purpose — so the handoff
 * would sit in `getMutationCache()` for as long as the document survived. In a
 * browser that is a moment; in a browser where the navigation is refused by an
 * extension it is indefinite. Resetting makes the narrow window a property
 * rather than a consequence of the page going away.
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
        impersonate.mutate(user.id, {
          onSuccess: ({ token }) => {
            /*
             * The address is built **before** the latch, so a throw in
             * `handoffUrl` cannot leave the confirm permanently refusing its
             * own button. Unreachable now that the config schema constrains
             * the scheme, and the ordering costs nothing.
             */
            const url = handoffUrl(token);

            /*
             * No `onClose()` first: this document is leaving, and closing the
             * dialog would flash the grid behind it for the duration of a
             * navigation. A refusal leaves the confirm open with its toast,
             * which is `ConfirmDialog`'s own contract.
             */
            setLeaving(true);
            window.open(url, "_self");
            // After the handover, never before it: `reset()` clears the
            // mutation's `data`, and the token is read out of it one line up.
            impersonate.reset();
          },
        });
      }}
    />
  );
};
