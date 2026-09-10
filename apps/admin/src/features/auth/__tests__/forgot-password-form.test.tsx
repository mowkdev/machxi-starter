import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  CREDENTIALS,
  createAuthHandlers,
  createAuthMockState,
  type AuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import { server } from "@repo/app-kit/testing";
import { createSessionStore } from "@/shared/api/session-store";
import { renderApp } from "@/test/render";

/**
 * "Email me a recovery link" (`D18.6`, ADR-0071 §4).
 *
 * Driven through the real route tree from `/forgot-password`, so the `_auth`
 * layout and its mirror guard are exercised rather than re-declared — the
 * sign-in suite's shape, for the second screen in that family.
 *
 * **The property this file exists for is a negative one**: that the screen says
 * the *same thing* whatever address it is given. ADR-0020 §Enumeration is the
 * whole design of the endpoint, and on this segment an oracle would enumerate
 * the people who can administer the deployment. The way that is thrown away is
 * not a wrong status code but a client that renders "check your inbox" for one
 * address and "we could not find that one" for another — so the two cases below
 * assert the same node, over one address the mock's world holds and one it does
 * not.
 */

const STRANGER = "nobody@machxi.local";

/** The one sentence there is, as the catalogue writes it. */
const CONFIRMATION = /If that address has an account, a link is on its way/;

let state: AuthMockState;

beforeEach(() => {
  state = createAuthMockState();
  server.use(...createAuthHandlers(state));
});

const setup = () => ({
  user: userEvent.setup(),
  // An empty store: `_auth`'s mirror guard sends a signed-in operator to the
  // dashboard, so a session here would render that and assert nothing.
  ...renderApp({
    initialPath: "/forgot-password",
    store: createSessionStore(),
  }),
});

const ask = async (
  user: ReturnType<typeof userEvent.setup>,
  email: string,
): Promise<void> => {
  const field = await screen.findByLabelText("Email");

  await user.clear(field);
  await user.type(field, email);
  await user.click(screen.getByRole("button", { name: "Email me a link" }));
};

describe("asking for a recovery link", () => {
  it("confirms an address that has an account", async () => {
    const { user } = setup();

    await ask(user, CREDENTIALS.email);

    expect(await screen.findByText(CONFIRMATION)).toBeInTheDocument();
    expect(state.forgotPasswordCalls).toEqual([
      // The locale travels in the body because the server must not read a
      // stored one to answer (ADR-0071 §2, §4).
      { email: CREDENTIALS.email, locale: "en" },
    ]);
  });

  it("says exactly the same thing about an address nobody holds", async () => {
    const { user } = setup();

    await ask(user, STRANGER);

    expect(await screen.findByText(CONFIRMATION)).toBeInTheDocument();
    /*
     * And nothing else on the screen distinguishes them either: the assertion
     * above would pass while a second sentence sat beside it, so the sentence
     * is checked to be the only status the screen reports.
     */
    expect(
      screen.getAllByRole("status").map((node) => node.textContent),
    ).toEqual([screen.getByText(CONFIRMATION).textContent]);
    expect(state.forgotPasswordCalls).toEqual([
      { email: STRANGER, locale: "en" },
    ]);
  });

  it("takes the confirmation back when the address is edited", async () => {
    const { user } = setup();

    await ask(user, CREDENTIALS.email);
    expect(await screen.findByText(CONFIRMATION)).toBeInTheDocument();

    /*
     * The confirmation was about the address that was sent: the person it
     * would mislead is the one who mistyped the address they are trying to
     * recover and is now looking at a promise about a different one.
     */
    await user.type(screen.getByLabelText("Email"), "x");

    expect(screen.queryByText(CONFIRMATION)).not.toBeInTheDocument();
  });

  it("never leaves the browser with an address the schema refuses", async () => {
    const { user } = setup();

    await ask(user, "not-an-address");

    /*
     * `forgotPasswordBody` is the object the API validates with (ADR-0011,
     * ADR-0023), and both of §4's budgets are spent by a request the schema
     * goes on to refuse — so a client that posted this would burn a stranger's
     * mailbox budget on a typo.
     */
    expect(state.forgotPasswordCalls).toEqual([]);
    expect(screen.queryByText(CONFIRMATION)).not.toBeInTheDocument();
  });
});
