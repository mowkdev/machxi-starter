import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createAuthHandlers,
  createAuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import { server } from "@repo/app-kit/testing";
import { createSessionStore } from "@/shared/api/session-store";
import type { AppFeatures } from "@/shared/config";
import { renderApp } from "@/test/render";

/**
 * The sign-up screen's "Continue with Google" (`D19.3`, ADR-0072 §4): under
 * the card, and **only where both flags are on** — Google creates an account
 * where registration is open (§1), so the button belongs on this screen only
 * where both halves of that are true. The form is `features/auth`'s suite.
 */

beforeEach(() => {
  server.use(...createAuthHandlers(createAuthMockState()));
});

const visit = (features: AppFeatures) =>
  renderApp({
    initialPath: "/register",
    store: createSessionStore(),
    features,
  });

const googleButton = () =>
  screen.queryByRole("button", { name: "Continue with Google" });

describe("continue with Google on the sign-up screen", () => {
  it("is there when registration and Google are both on", async () => {
    visit({ userRegistration: true, googleSignIn: true });

    expect(
      await screen.findByRole("button", { name: "Continue with Google" }),
    ).toBeInTheDocument();
  });

  it("is absent when Google is off, even with registration on", async () => {
    visit({ userRegistration: true, googleSignIn: false });

    expect(
      await screen.findByRole("button", { name: "Create account" }),
    ).toBeInTheDocument();
    expect(googleButton()).toBeNull();
  });

  it("is absent when registration is off, even with Google on", async () => {
    /*
     * The route answers not-found with registration off (`D15.6`), so the
     * screen the button would sit under does not exist — the second flag is
     * the route's to enforce and the page's to state. **This case proves the
     * route, not the page's conjunct** (`D19.3`'s `code-reviewer`): the page
     * never renders with registration off, so its `userRegistration &&` is
     * documentation of the record's rule rather than a branch any test can
     * reach.
     */
    visit({ userRegistration: false, googleSignIn: true });

    expect(
      await screen.findByText("That address does not exist."),
    ).toBeInTheDocument();
    expect(googleButton()).toBeNull();
  });
});
