import { useEffect, useState } from "react";

import { useApiClient } from "@/shared/api/context";
import { useLocale, useT } from "@/shared/i18n";
import { useMessageForError } from "@/shared/notifications/messages";
import { Button, FieldError } from "@/shared/ui";

import { GoogleMark } from "./google-mark";
import { rememberRedirect } from "./redirect-memory";

/**
 * ADR-0054 §7's 38px rung, as every auth card in this app spells it — this
 * button sits under those cards and is the same size of decision.
 */
const AUTH_CONTROL = "h-[38px] w-full text-[13px]";

/**
 * Where the browser may be sent: Google's authorization endpoint, which is
 * `https` and nothing else.
 *
 * The URL is the API's and the API is trusted, so this is not a check on the
 * API's honesty — it is the fence that keeps a `javascript:` or `data:` value
 * from ever being *navigated to* in this origin, whatever produced it. A value
 * that fails it is treated as a failed start, whose sentence is the
 * catalogue's fallback.
 */
export const safeAuthorizationUrl = (value: string): string => {
  const url = new URL(value);

  if (url.protocol !== "https:") {
    throw new Error("The authorization URL is not an https address");
  }

  return url.href;
};

/**
 * "Continue with Google" (ADR-0072 §4) — under the sign-in card, and under the
 * sign-up card when registration is on too.
 *
 * **It posts `start` and then leaves**, and the order is the design: the start
 * is an XHR because a navigation would be a link anyone could plant (§2), and
 * its answer is the one place the browser is sent next. There is no Google
 * script behind this button and no external asset in front of it.
 *
 * **`window.open(url, "_self")` rather than `location.assign`**, which is the
 * admin's impersonation dialog's choice for its reason: the two are the same
 * navigation of the same browsing context, and `Location`'s members are
 * `[LegacyUnforgeable]` — non-configurable in a browser and in jsdom alike —
 * so the suite could only observe the assignment through an indirection
 * module this harness refuses (`test/render.tsx`: no `vi.mock`). `_self`
 * creates no context, so no popup heuristic applies.
 *
 * **The button stays disabled once the start has answered**, because the page
 * is unloading: a second press between the answer and the navigation would
 * post a second start, whose cookie would overwrite the first and strand the
 * callback that is already on its way. A refusal re-enables it with the
 * catalogue's sentence for the code — `404 ROUTE_NOT_FOUND` when this build
 * offers the button against an API with no Google client (the API is the
 * control, ADR-0072 §4), `429` from the start's own limiter, `503` when Google
 * cannot be reached.
 *
 * The locale travels in the body because nobody is known to be acting yet:
 * it rides the transaction cookie to the callback, which has no account whose
 * stored locale it could read (ADR-0072 §2).
 *
 * **`redirect` is remembered before leaving** (ADR-0072 §4, amended after
 * `D19.3`): the sign-in screen's own, already fenced by its route, left under
 * the app's device key for the landing route to take once — and cleared when
 * this screen has none, so an abandoned attempt's value is never inherited.
 */
export interface ContinueWithGoogleProps {
  /** The sign-in screen's `redirect`, when the guard or a link set one. */
  readonly redirect?: string | undefined;
}

export const ContinueWithGoogle = ({ redirect }: ContinueWithGoogleProps) => {
  const { t } = useT("auth");
  const client = useApiClient();
  const { locale } = useLocale();
  const messageForError = useMessageForError();

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * **Released when the page comes back from the back/forward cache**
   * (`D19.3`'s two reviewers). A person who presses Back on Google's account
   * chooser gets this page restored exactly as it was left — button disabled —
   * and nothing else would ever re-enable it. The flow it started is abandoned
   * by then, so a fresh start overwriting its transaction cookie is the right
   * outcome rather than the stranding the paragraph above guards against.
   */
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false);
    };

    window.addEventListener("pageshow", onPageShow);

    return () => {
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  const onClick = async () => {
    setPending(true);
    setError(null);

    try {
      const { authorizationUrl } = await client.startGoogleSignIn({ locale });
      const destination = safeAuthorizationUrl(authorizationUrl);

      rememberRedirect(redirect);
      window.open(destination, "_self");
    } catch (failure) {
      setError(messageForError(failure));
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        aria-busy={pending}
        className={AUTH_CONTROL}
        disabled={pending}
        onClick={() => void onClick()}
        type="button"
        variant="outline"
      >
        <GoogleMark />
        {t("google.continue")}
      </Button>
      {error === null ? null : <FieldError role="alert">{error}</FieldError>}
    </div>
  );
};
