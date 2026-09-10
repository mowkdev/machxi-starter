import { createFileRoute } from "@tanstack/react-router";

import { ForgotPasswordPage } from "@/pages/forgot-password";

/**
 * `/forgot-password`, inside the `_auth` shell (ADR-0071 §4). A route file is
 * wiring (ADR-0049): a path, the page it mounts, and the copy the shell heads
 * it with.
 *
 * **Under `_auth`, unlike the link's own landing route.** Nothing is mailed to
 * this address — it is the form that *asks* for the mail — so the mirror
 * guard's rule is simply right here: somebody who already has a session in this
 * browser does not need a recovery link, and the account area's change-password
 * screen is the path for them. `/reset-password` is the one that has to stand
 * outside both layouts, because that is where a link lands.
 *
 * **No `validateSearch`**: nothing arrives in the query string. The address to
 * recover is typed, deliberately — a screen that could only ask about an
 * address it was handed would strand the person who mistyped theirs, and an
 * address in the query string is an address in the history, in a screen-share,
 * and in a `Referer`.
 */
export const Route = createFileRoute("/_auth/forgot-password")({
  component: ForgotPasswordPage,
  staticData: {
    description: "auth:forgot.subtitle",
    title: "auth:forgot.title",
  },
});
