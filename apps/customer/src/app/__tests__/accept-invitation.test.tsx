import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import {
  PUBLIC_API,
  createAuthHandlers,
  createAuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import { fail } from "@/test/msw/handlers/envelope";
import {
  createProfileHandlers,
  createProfileMockState,
} from "@/test/msw/handlers/profile.handlers";
import {
  INVITATION_TOKEN,
  RECEIVED_INVITATION,
  createOrganizationsHandlers,
  createOrganizationsMockState,
  type OrganizationsMockState,
} from "@/test/msw/handlers/organizations.handlers";
import { server } from "@repo/app-kit/testing";
import { createSessionStore } from "@/shared/api/session-store";
import { authenticated } from "@/test/principals";
import { renderApp } from "@/test/render";

/**
 * `/invitations/accept` — where the mailed invitation lands (`D18.8`,
 * ADR-0071 §5).
 *
 * Driven through the generated route tree on a memory history, because the
 * credential arrives in the **URL fragment** and a hand-built tree would be
 * asserting the test's own parsing. `renderApp` hands `initialPath` straight
 * to `createMemoryHistory`, so `#token=…` reaches the router exactly as a
 * browser would deliver it — `/verify-email`'s and `/reset-password`'s
 * harness, one flow along.
 *
 * **The three landings are the point of the file**, and they are three
 * *sessions* over one link rather than three screens: an invitation is
 * addressed to a mailbox and the link is followed wherever the mail is read,
 * so the screen has to work for somebody with no account, for the person it
 * was sent to, and for whoever else happens to be signed into this browser.
 * The page wears its own shell for exactly that reason — neither layout guard
 * can be right for all three — and these cases are what says so.
 */

/** A stranger's address: no account of this fixture's holds it. */
const STRANGER = "somebody.else@machxi.local";

const link = (token: string) =>
  `/invitations/accept#${new URLSearchParams({ token }).toString()}`;

let organizations: OrganizationsMockState;

beforeEach(() => {
  organizations = createOrganizationsMockState();
  server.use(
    ...createAuthHandlers(createAuthMockState()),
    /*
     * The shell reads the profile and the switcher reads `GET /user/orgs` on
     * every screen behind the guard (`D15.5`), and acceptance lands on one —
     * answered rather than left unhandled, because MSW runs with
     * `onUnhandledRequest: "error"` and a suite whose shell is half-failed is
     * a suite certifying a screen nobody ships.
     */
    ...createProfileHandlers(createProfileMockState()),
    ...createOrganizationsHandlers(organizations),
  );
});

describe("following an invitation link", () => {
  it("offers a stranger a sign-up fixed to the invited address", async () => {
    // No session: the ordinary arrival for somebody who has just been invited
    // to a deployment they have never used.
    renderApp({
      initialPath: link(INVITATION_TOKEN),
      store: createSessionStore(),
    });

    expect(
      await screen.findByText(
        `${RECEIVED_INVITATION.organizationName} has invited you to join as Admin.`,
      ),
    ).toBeInTheDocument();

    /*
     * **Filled in and read only**, which is what "prefilled and locked" means
     * on a control a person still has to be able to read: any other address
     * would create an account this invitation cannot reach, because an offer
     * is addressed to a mailbox rather than to a person.
     */
    const email = screen.getByLabelText("Email");

    expect(email).toHaveValue(RECEIVED_INVITATION.email);
    expect(email).toHaveAttribute("readonly");

    // And the other way in, for somebody who does have an account.
    expect(
      screen.getByRole("link", { name: "Already have an account? Sign in" }),
    ).toBeInTheDocument();

    // Nothing was spent: the lookup is a read, and joining needs a session.
    expect(organizations.seen.lookedUp).toEqual([INVITATION_TOKEN]);
    expect(organizations.seen.acceptedByToken).toEqual([]);
  });

  it("lets the invited account holder accept, and lands them in the organization", async () => {
    const user = userEvent.setup();
    // The fixture invitation is addressed to this account's own address, which
    // is the agreement the endpoint requires: the token proves the mailbox and
    // the session proves the account.
    const { router } = renderApp({
      initialPath: link(INVITATION_TOKEN),
      store: authenticated(),
    });

    await user.click(
      await screen.findByRole("button", { name: "Accept the invitation" }),
    );

    /*
     * Landed **in** the organization rather than on a screen saying it
     * happened: the acceptance answers with the organization joined, the
     * entity hook invalidates the switcher's list, and the home screen names
     * the context the customer is now acting in.
     */
    expect(
      await screen.findByText(
        `You are in ${RECEIVED_INVITATION.organizationName}.`,
      ),
    ).toBeInTheDocument();

    expect(organizations.seen.acceptedByToken).toEqual([INVITATION_TOKEN]);
    expect(router.state.location.pathname).toBe(
      `/orgs/${RECEIVED_INVITATION.organizationName.toLowerCase()}`,
    );
    /*
     * `replace`, so Back cannot return to a screen holding a link that has now
     * been spent. One entry, which is the arrival itself.
     */
    expect(router.history.length).toBe(1);
  });

  it("tells a browser signed in as somebody else, plainly, and offers no way to accept", async () => {
    /*
     * The mock is told who is holding the browser as well, because a handler
     * cannot read a principal out of a fake bearer and the refusal it gates is
     * the whole point of the endpoint (ADR-0036's load-bearing rule).
     */
    organizations.callerEmail = STRANGER;

    renderApp({
      initialPath: link(INVITATION_TOKEN),
      store: authenticated({ email: STRANGER }),
    });

    expect(
      await screen.findByText(
        new RegExp(`sent to ${RECEIVED_INVITATION.email}`),
      ),
    ).toBeInTheDocument();
    // Both addresses, because "this is not your invitation" is useless to
    // somebody who cannot see which of their mailboxes it went to.
    expect(screen.getByText(new RegExp(STRANGER))).toBeInTheDocument();

    // No control that would spend the link, so nothing is spent — and the link
    // still works in the browser it was meant for.
    expect(
      screen.queryByRole("button", { name: "Accept the invitation" }),
    ).toBeNull();
    expect(organizations.seen.acceptedByToken).toEqual([]);

    /*
     * Signing **out** rather than a link to `/login`: the reader has a session,
     * and `_auth`'s mirror guard would send them straight home from the
     * sign-in screen.
     */
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });

  it("says one thing about every link it cannot read", async () => {
    renderApp({
      initialPath: link("a-withdrawn-link"),
      store: createSessionStore(),
    });

    /*
     * Unknown, accepted, declined, revoked, expired and organization-deleted
     * are one indistinguishable `404` (ADR-0071 §5), so a client offering a
     * sharper story would be inventing a distinction the server declines to
     * make. The way forward is not a control — nothing on this screen can mint
     * another offer — so the sentence carries it.
     */
    expect(
      await screen.findByText(/This invitation link cannot be used/),
    ).toBeInTheDocument();

    expect(organizations.seen.lookedUp).toEqual(["a-withdrawn-link"]);
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  it("asks nothing at all when the address carries no link", async () => {
    renderApp({
      initialPath: "/invitations/accept",
      store: createSessionStore(),
    });

    expect(
      await screen.findByText(/This invitation link cannot be used/),
    ).toBeInTheDocument();

    // MSW runs with `onUnhandledRequest: "error"`, so a stray request would
    // have failed the render rather than this line.
    expect(organizations.seen.lookedUp).toEqual([]);
  });

  it("strikes the credential out of the address before anybody reads the offer", async () => {
    /*
     * The widest of the three fragment windows in this app: this token is not
     * spent by arriving, so without the strike it would sit in the address bar
     * for as long as somebody takes to read an offer and decide — in the
     * session history, in whatever a screen-share is showing, and in a
     * `Referer` the moment anything on the page loads a third-party asset.
     * `replace`, so Back cannot walk to the entry that carried it.
     */
    const { router } = renderApp({
      initialPath: link(INVITATION_TOKEN),
      store: authenticated(),
    });

    expect(
      await screen.findByRole("button", { name: "Accept the invitation" }),
    ).toBeInTheDocument();

    expect(router.state.location.hash).toBe("");
    expect(router.state.location.pathname).toBe("/invitations/accept");
    expect(router.history.length).toBe(1);
  });

  it("asks the lookup once per link under StrictMode's double invocation", async () => {
    /*
     * **Rendered under `StrictMode` on purpose** (`D18.8`, `code-reviewer`).
     * The app mounts one (`app/index.tsx`) and `renderApp` does not, so the
     * first version of this case could not fail: without double invocation the
     * effect is self-terminating anyway — the strike empties the fragment and
     * the re-run finds no token — and deleting the latch would have kept it
     * green. `session-provider.test.tsx` is the precedent for asking a suite
     * to render the development mode the app actually ships.
     *
     * What the latch buys is that one arrival costs one request of the
     * lookup's source-keyed budget rather than two.
     */
    renderApp({
      initialPath: link(INVITATION_TOKEN),
      store: createSessionStore(),
      strict: true,
    });

    expect(await screen.findByLabelText("Email")).toBeInTheDocument();

    await waitFor(() => {
      expect(organizations.seen.lookedUp).toEqual([INVITATION_TOKEN]);
    });
  });

  it("keeps the link, and offers to ask again, when the check itself fails", async () => {
    /*
     * `lookup` carries ADR-0020's numbers keyed on the **source alone**, which
     * behind an office egress is everybody there — so a `429` is an ordinary
     * answer about a perfectly live invitation. Calling that a dead link would
     * send the reader to have the only working link revoked and replaced, and
     * the fragment has already been struck, so they could not retry from this
     * tab either (`D18.8`, both reviewers).
     */
    const user = userEvent.setup();
    let attempts = 0;

    /*
     * The first ask is refused and the second falls through to the default
     * handler, which is what records the token — so `seen.lookedUp` counts the
     * *answered* ask and `attempts` counts both.
     */
    server.use(
      http.post(`${PUBLIC_API}/invitations/lookup`, () => {
        attempts += 1;
        return attempts === 1 ? fail(429, "RATE_LIMITED") : undefined;
      }),
    );

    renderApp({
      initialPath: link(INVITATION_TOKEN),
      store: authenticated(),
    });

    expect(
      await screen.findByText(/could not be checked just now/),
    ).toBeInTheDocument();
    // The catalogue's sentence for the code, beside the screen's own.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Wait a moment and try again.",
    );
    expect(screen.queryByText(/cannot be used/)).toBeNull();

    // And the held link is still good, which is the whole point of keeping it.
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("button", { name: "Accept the invitation" }),
    ).toBeInTheDocument();
    expect(attempts).toBe(2);
    expect(organizations.seen.lookedUp).toEqual([INVITATION_TOKEN]);
  });

  it("offers a stranger no sign-up where the deployment has closed them", async () => {
    /*
     * The flag `/register`'s `beforeLoad` reads (`D18.8`,
     * `security-reviewer`). With self-registration off that address does not
     * exist and the endpoint answers `404`, so a sign-up card here would be
     * the one screen in the app that re-opens a disabled affordance — filled
     * in, and refused generically. The offer still reads; only the way forward
     * changes.
     */
    renderApp({
      features: { userRegistration: false },
      initialPath: link(INVITATION_TOKEN),
      store: createSessionStore(),
    });

    expect(
      await screen.findByText(new RegExp(`Sign in with that address`)),
    ).toBeInTheDocument();

    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Already have an account? Sign in" }),
    ).toBeInTheDocument();
  });
});
