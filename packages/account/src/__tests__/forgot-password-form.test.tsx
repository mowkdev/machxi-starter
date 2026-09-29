import type { ApiSegment } from "@repo/api-client";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { createPasswordRecovery } from "../password-reset";

import {
  createRecoveryHandlers,
  createRecoveryMockState,
  type RecoveryMockState,
} from "./support/recovery.handlers";
import { APP_COPY, renderAccount, useMessageForError } from "./support/render";
import { server } from "./support/server";

/**
 * "Email me a recovery link" (`D18.6`, ADR-0071 §4) — certified here since
 * `D22.2`, where the form lives (ADR-0077 §4). It was two suites, one per app
 * and the same four cases in each; they are one copy now, and each app's door
 * keeps a smoke case proving its binding through the real route tree.
 *
 * The form is rendered directly, out of `createPasswordRecovery` with the
 * harness's stand-ins for what an app binds. Nothing on this screen navigates,
 * so the three navigation members are inert here; the reset suite is where
 * they are exercised.
 *
 * **The property this file exists for is a negative one**: that the screen
 * says the *same thing* whatever address it is given. ADR-0020 §Enumeration is
 * the whole design of the endpoint, and on the admin segment an oracle would
 * enumerate the people who can administer the deployment. The way that is
 * thrown away is not a wrong status code but a client that renders "check your
 * inbox" for one address and "we could not find that one" for another — so two
 * of the cases below assert the same node, over two different addresses.
 */

const KNOWN = "person@machxi.local";
const STRANGER = "nobody@machxi.local";

/** The one sentence there is, as the package's catalogue writes it. */
const CONFIRMATION = /If that address has an account, a link is on its way/;

const RequestLink = ({
  className,
  children,
}: {
  readonly className: string;
  readonly children: ReactNode;
}) => (
  <a className={className} href="/forgot-password">
    {children}
  </a>
);

const { ForgotPasswordForm } = createPasswordRecovery({
  useMessageForError,
  // Inert: asking for a link reads no address and goes nowhere.
  useLocationHash: () => "",
  useRecoveryNavigation: () => ({
    strikeToken: () => Promise.resolve(),
    toSignIn: () => Promise.resolve(),
  }),
  RequestLink,
});

const setup = (
  segment: ApiSegment = "user",
  script: Partial<RecoveryMockState> = {},
) => {
  const state: RecoveryMockState = { ...createRecoveryMockState(), ...script };

  server.use(...createRecoveryHandlers(state, segment));

  return {
    state,
    user: userEvent.setup(),
    ...renderAccount(<ForgotPasswordForm />, { segment }),
  };
};

const ask = async (
  user: ReturnType<typeof userEvent.setup>,
  email: string,
): Promise<void> => {
  const field = screen.getByLabelText("Email");

  await user.clear(field);
  await user.type(field, email);
  await user.click(screen.getByRole("button", { name: "Email me a link" }));
};

describe("asking for a recovery link", () => {
  /*
   * Over both segments, because the handlers answer on one: the request goes
   * to the client's own segment or it meets `onUnhandledRequest: "error"`.
   */
  it.each<ApiSegment>(["user", "admin"])(
    "confirms an address that has an account, on the %s segment",
    async (segment) => {
      const { user, state } = setup(segment);

      await ask(user, KNOWN);

      expect(await screen.findByText(CONFIRMATION)).toBeInTheDocument();
      expect(state.forgotPasswordCalls).toEqual([
        // The locale travels in the body because the server must not read a
        // stored one to answer (ADR-0071 §2, §4).
        { email: KNOWN, locale: "en" },
      ]);
    },
  );

  it("says exactly the same thing about an address nobody holds", async () => {
    const { user, state } = setup();

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
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(state.forgotPasswordCalls).toEqual([
      { email: STRANGER, locale: "en" },
    ]);
  });

  it("takes the confirmation back when the address is edited", async () => {
    const { user } = setup();

    await ask(user, KNOWN);
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
    const { user, state } = setup();

    await ask(user, "not-an-address");

    /*
     * `forgotPasswordBody` is the object the API validates with (ADR-0011,
     * ADR-0023), and both of §4's budgets are spent by a request the schema
     * goes on to refuse — so a client that posted this would burn a stranger's
     * mailbox budget on a typo.
     *
     * The field is marked first, so the case cannot pass by the submit handler
     * never having run at all.
     */
    expect(await screen.findByText(/invalid email/i)).toBeInTheDocument();
    expect(state.forgotPasswordCalls).toEqual([]);
    expect(screen.queryByText(CONFIRMATION)).not.toBeInTheDocument();
  });

  it("says a refused request in the app's own words, and confirms nothing", async () => {
    /*
     * A `429` from either of §4's budgets is a fact about the caller and the
     * mailbox's traffic, not about the mailbox's contents, so it gets a
     * sentence — and the sentence is the *app's*, through the code map the
     * door passes (ADR-0034, ADR-0077 §2). The harness's catalogue is worded
     * like neither app's, so reading it here can only mean the dependency was
     * used; the API's own `message` is never rendered (ADR-0013).
     */
    const { user, state } = setup("user", {
      forgotFailsWith: { status: 429, code: "RATE_LIMITED" },
    });

    await ask(user, KNOWN);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      APP_COPY.errors.RATE_LIMITED,
    );
    expect(screen.queryByText(CONFIRMATION)).not.toBeInTheDocument();
    expect(state.forgotPasswordCalls).toHaveLength(1);

    // And the form is handed back: trying again in a moment is the remedy.
    expect(
      screen.getByRole("button", { name: "Email me a link" }),
    ).toBeEnabled();
  });
});
