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
 * `/forgot-password` — this app's door onto `@repo/account`'s recovery form
 * (`D22.2`, ADR-0077 §4; the screen is `D18.6`'s, ADR-0071 §4).
 *
 * **One smoke case, proving the binding.** What the form does — that it says
 * the same thing about every address, takes its confirmation back, refuses an
 * address the schema refuses, and words a `429` through the code map — is
 * certified once, in the package's own `forgot-password-form.test.tsx`, where
 * this suite's four cases and its twin's moved.
 *
 * What is left is what only this app can prove: that the route is reachable
 * anonymously under the `_auth` layout and its mirror guard, through the real
 * route tree; that the form the door re-exports is mounted on it with this
 * app's catalogue; and that the request goes to this app's own segment, which
 * is the whole of the population rule.
 */

let state: AuthMockState;

beforeEach(() => {
  state = createAuthMockState();
  server.use(...createAuthHandlers(state));
});

const setup = () => ({
  user: userEvent.setup(),
  // An empty store: `_auth`'s mirror guard sends a signed-in visitor to
  // home, so a session here would render that and assert nothing.
  ...renderApp({
    initialPath: "/forgot-password",
    store: createSessionStore(),
  }),
});

describe("asking for a recovery link, through this app's door", () => {
  it("is reachable signed out, and posts the address to this app's segment", async () => {
    const { user, router } = setup();

    await user.type(await screen.findByLabelText("Email"), CREDENTIALS.email);
    await user.click(screen.getByRole("button", { name: "Email me a link" }));

    expect(
      await screen.findByText(
        /If that address has an account, a link is on its way/,
      ),
    ).toBeInTheDocument();
    // Still here: the guard let an anonymous visitor stay.
    expect(router.state.location.pathname).toBe("/forgot-password");
    // The handlers answer on this app's segment alone, so a call recorded is
    // a call that went there.
    expect(state.forgotPasswordCalls).toEqual([
      { email: CREDENTIALS.email, locale: "en" },
    ]);
  });
});
