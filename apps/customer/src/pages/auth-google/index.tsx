import { Link } from "@tanstack/react-router";

import { useGoogleLanding, type GoogleLandingStatus } from "@/features/auth";

import { useT } from "@/shared/i18n";
import { useRouteTitle } from "@/shared/lib/route-meta";
import { AuthLayout, Button } from "@/shared/ui";

/**
 * The sentence per state, as a table rather than an interpolated key — the
 * compiler checks a table, and a template literal would stop resolving the
 * moment a state's key stopped matching its name. `failed` is not in it: its
 * sentence is the errors catalogue's, for the code the callback sent.
 */
const MESSAGE_KEY = {
  pending: "google.pending",
  signedIn: "google.signedIn",
  linking: "google.linking",
  returning: "google.returning",
  refused: "google.refused",
  missing: "google.missing",
} as const satisfies Readonly<
  Record<Exclude<GoogleLandingStatus, "failed">, string>
>;

/** The states a person is left sitting on, which are the ones with a way out. */
const STRANDED: ReadonlySet<GoogleLandingStatus> = new Set([
  "refused",
  "failed",
  "missing",
]);

/**
 * The states that are a failure rather than a step on the way (`D28.8`, the
 * review's `FE-11`): read out as an alert, where every other state is a status
 * a screen reader announces when it gets to it.
 */
const FAILED: ReadonlySet<GoogleLandingStatus> = new Set(["refused", "failed"]);

/** ADR-0054 §7's 38px rung, as the auth cards spell it. */
const AUTH_CONTROL = "h-[38px] text-[13px]";

/**
 * `/auth/google` — where Google's callback hands the person back to this app
 * (ADR-0072 §2, §4).
 *
 * A page is thin composition (ADR-0049): the feature reads the fragment and
 * acts on it, and this renders the one sentence there is to say while it
 * does, the confirmation on the one state that holds a live handoff, and the
 * way back to sign in on the states a person is left sitting on.
 *
 * **It composes `AuthLayout` itself rather than sitting under `_auth`** — the
 * `/impersonate` and `/verify-email` screens' constraint exactly. `_auth`
 * sends a visitor who already has a session home, and a person may finish a
 * Google sign-in in a browser that holds one; under that guard the handoff
 * would be redirected away before the screen could ask them about it.
 *
 * **A refusal is the catalogue's sentence for its code**, and the API's own
 * error body is never what a person sees: every refusal reaches this route as
 * `#error=<code>` and nothing else (§2), so the code is the whole message.
 * The link is to `/login` whatever the code, because every refusal this route
 * renders is a sign-in that did not happen: a refusal in a browser holding a
 * session is a link's, and goes on to the security section instead (§4,
 * amended after `D19.3`).
 */
export const AuthGooglePage = () => {
  const { t } = useT("auth");
  const { t: tErrors } = useT("errors");
  const { status, failure, confirm } = useGoogleLanding();
  /*
   * The fallback is the key the route declares: a screen that is its own
   * shell always matches a route that declares one, so it is unreachable
   * rather than a second place the copy lives (`/verify-email`'s shape).
   */
  const title = useRouteTitle("auth:google.title");

  /*
   * `defaultValue` is ADR-0034's degrade rule, as `createMessageForError`
   * applies it: a code this bundle knows but whose sentence is missing still
   * reads as a sentence rather than as a raw `SCREAMING_SNAKE`.
   */
  const sentence =
    status === "failed"
      ? tErrors(failure ?? "fallback", { defaultValue: tErrors("fallback") })
      : t(MESSAGE_KEY[status]);

  return (
    <AuthLayout description={undefined} title={title}>
      <div className="flex flex-col gap-4">
        {/*
         * A live region, because the sentence changes under the reader without
         * a navigation — `pending` to a refusal is the whole of what this
         * screen has to say (`D28.8`, `FE-11`). Keyed on the role, so a failure
         * arrives as a new `alert` node rather than as a role rewritten on the
         * status node, which assistive technology does not reliably re-read.
         */}
        <p
          className="text-[14px] leading-5 text-muted-foreground"
          key={FAILED.has(status) ? "alert" : "status"}
          role={FAILED.has(status) ? "alert" : "status"}
        >
          {sentence}
        </p>
        {/*
         * The confirmation the ask-first rule asks for, on the one state that
         * holds a live handoff and has not spent it (ADR-0071 §3 as amended at
         * `D18.4`, inherited by ADR-0072 §2).
         */}
        {status === "signedIn" ? (
          <Button className={AUTH_CONTROL} onClick={confirm} type="button">
            {t("google.confirm")}
          </Button>
        ) : null}
      </div>
      {STRANDED.has(status) ? (
        <p className="mt-4 text-center text-[13px] text-muted-foreground">
          {/*
           * Under the controls in the card's small type, `/verify-email`'s
           * shape: "go back to sign in" is navigation, not a control.
           */}
          <Link
            className="underline underline-offset-4"
            search={{}}
            to="/login"
          >
            {t("google.signIn")}
          </Link>
        </p>
      ) : null}
    </AuthLayout>
  );
};
