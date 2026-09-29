import type { ApiSegment } from "@repo/api-client";
import type { TranslationKey } from "@repo/i18n";
import { QueryClient } from "@tanstack/react-query";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  createPasswordRecovery,
  type RecoveryNavigation,
} from "../password-reset";

import {
  RESET_TOKEN,
  createRecoveryHandlers,
  createRecoveryMockState,
  type RecoveryMockState,
} from "./support/recovery.handlers";
import { APP_COPY, renderAccount, useMessageForError } from "./support/render";
import { server } from "./support/server";

/**
 * Choosing a new password from a recovery link (`D18.6`, ADR-0071 §4) —
 * certified here since `D22.2`, where the hook and the form live (ADR-0077
 * §4). It was two near-twin suites driven through each app's route tree; what
 * they claimed about the *screen* is one copy here, and what they claimed
 * about a *route tree* — the real address bar, the real landing on `/login`,
 * the customer's toast — stays at each app's door.
 *
 * **The router is stood in for, by the smallest thing of its shape** (ADR-0077
 * §2: navigation leaves the package as callbacks). The address is a tiny
 * external store read through `useSyncExternalStore`, so a test can put
 * `token=…` in it — before the screen mounts, or into a tab that is already
 * open — and the two navigations are stable functions that record their calls.
 * `strikeToken` really empties that store, because the hook's effect is
 * self-terminating only if the strike is observable in the fragment it reads.
 *
 * Every dependency is passed, never module-mocked (ADR-0036).
 */

const NEW_PASSWORD = "DevPassword!456";

const REFUSED = /This link cannot be used/;

/**
 * The fragment **as a router hands it over, without the `#`** — which is how
 * both apps' bindings read it (`state.location.hash`) and what the hook's
 * `URLSearchParams` parses. `window.location.hash` spells it with the `#`.
 */
const fragment = (token: string) => new URLSearchParams({ token }).toString();

/** The address bar, as far as this screen reads it: a fragment and no more. */
const createAddress = (initial: string) => {
  let hash = initial;
  const listeners = new Set<() => void>();

  const write = (next: string) => {
    hash = next;
    for (const listener of listeners) listener();
  };

  return {
    read: () => hash,
    write,
    subscribe: (listener: () => void) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
};

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

interface World {
  /** What the address holds on arrival; `""` is a link that lost its token. */
  readonly hash?: string;
  readonly segment?: ApiSegment;
  readonly outcome?: TranslationKey;
  /** A router that cancels the landing on sign-in. */
  readonly signInIsCancelled?: boolean;
  readonly script?: Partial<RecoveryMockState>;
  readonly queryClient?: QueryClient;
}

/**
 * One bound recovery per case: the factory closes over its dependencies, so a
 * fresh address and fresh recorders mean nothing is shared between cases.
 */
const bind = ({
  hash = fragment(RESET_TOKEN),
  segment = "user",
  outcome,
  signInIsCancelled = false,
  script = {},
}: World = {}) => {
  const state: RecoveryMockState = { ...createRecoveryMockState(), ...script };

  server.use(...createRecoveryHandlers(state, segment));

  const address = createAddress(hash);
  const calls = { strikeToken: 0, toSignIn: 0 };

  // Built once and returned by reference: the strike is an effect dependency,
  // and `RecoveryNavigation` requires both functions to be stable.
  const navigation: RecoveryNavigation = {
    strikeToken: () => {
      calls.strikeToken += 1;
      address.write("");

      return Promise.resolve();
    },
    toSignIn: () => {
      calls.toSignIn += 1;

      return signInIsCancelled
        ? Promise.reject(new Error("navigation cancelled"))
        : Promise.resolve();
    },
  };

  const recovery = createPasswordRecovery({
    useMessageForError,
    useLocationHash: () =>
      useSyncExternalStore(address.subscribe, address.read),
    useRecoveryNavigation: () => navigation,
    RequestLink,
    outcome,
  });

  return { state, address, calls, recovery, segment };
};

const setup = (world: World = {}) => {
  const bound = bind(world);
  const { ResetPasswordForm } = bound.recovery;

  return {
    ...bound,
    user: userEvent.setup(),
    ...renderAccount(<ResetPasswordForm />, {
      segment: bound.segment,
      ...(world.queryClient === undefined
        ? {}
        : { queryClient: world.queryClient }),
    }),
  };
};

const choose = async (
  user: ReturnType<typeof userEvent.setup>,
  password: string,
): Promise<void> => {
  await user.type(await screen.findByLabelText("New password"), password);
  await user.click(
    screen.getByRole("button", { name: "Save the new password" }),
  );
};

/** A client with no retries, whose mutations a case can watch. */
const createWatchedClient = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const metas: unknown[] = [];

  /*
   * Read while the mutation runs, off the cache's own event:
   * `CREDENTIAL_MUTATION` is `gcTime: 0`, so there is nothing left in the
   * cache to look at once it has settled.
   */
  queryClient.getMutationCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "pending") {
      metas.push(event.mutation.options.meta);
    }
  });

  return { queryClient, metas };
};

describe("choosing a new password from the link", () => {
  /*
   * Over both segments, because the handlers answer on one: the request goes
   * to the client's own segment or it meets `onUnhandledRequest: "error"`.
   */
  it.each<ApiSegment>(["user", "admin"])(
    "posts the token out of the fragment and lands on sign-in, on the %s segment",
    async (segment) => {
      const { user, state, calls } = setup({ segment });

      await choose(user, NEW_PASSWORD);

      await waitFor(() => {
        expect(calls.toSignIn).toBe(1);
      });
      expect(state.resetPasswordCalls).toEqual([
        { token: RESET_TOKEN, newPassword: NEW_PASSWORD },
      ]);
      /*
       * And the form is not handed back on the way out: success is the one
       * path that leaves `pending` set, so nothing can be submitted twice
       * while the router is still landing.
       */
      expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    },
  );

  it("carries a token through the fragment's encoding untouched", async () => {
    /*
     * `URLSearchParams` rather than a split on `=`: the token is opaque, and a
     * value that grew a `=`, a `+` or a `&` would be truncated or rewritten by
     * anything hand-rolled.
     */
    const awkward = "a=b+c&d/e==";
    const { user, state, calls } = setup({
      hash: fragment(awkward),
      // Any token is refused by the mock's world but this one; the refusal is
      // scripted away so the case is about what was *posted*.
      script: { resetFailsWith: { status: 429, code: "RATE_LIMITED" } },
    });

    await choose(user, NEW_PASSWORD);

    await waitFor(() => {
      expect(state.resetPasswordCalls).toEqual([
        { token: awkward, newPassword: NEW_PASSWORD },
      ]);
    });
    expect(calls.toSignIn).toBe(0);
  });

  it("strikes the credential out of the address before anything is typed", async () => {
    const { address, calls } = setup();

    /*
     * The token is not spent on arrival, so without the strike it sits in the
     * address bar for however long somebody takes to choose a password — in
     * the session history, in whatever a screen-share is showing, and in a
     * `Referer` the moment anything on the page loads a third-party asset.
     */
    expect(await screen.findByLabelText("New password")).toBeInTheDocument();

    await waitFor(() => {
      expect(address.read()).toBe("");
    });
    /*
     * Once, and not again: the effect is self-terminating — the strike empties
     * the fragment, the re-run finds no token and returns.
     */
    expect(calls.strikeToken).toBe(1);
    expect(calls.toSignIn).toBe(0);
  });

  it("holds the credential out of the document, before and after it is spent", async () => {
    /*
     * A ref, never state and never the DOM: no hidden input, no attribute, no
     * text. Asked of the whole document rather than of the form, so a portal
     * would not hide it.
     */
    const { user, calls } = setup();

    expect(await screen.findByLabelText("New password")).toBeInTheDocument();
    expect(document.documentElement.innerHTML).not.toContain(RESET_TOKEN);

    await choose(user, NEW_PASSWORD);

    await waitFor(() => {
      expect(calls.toSignIn).toBe(1);
    });
    expect(document.documentElement.innerHTML).not.toContain(RESET_TOKEN);
  });

  it("renders the dead-link screen and a way to another when the token is refused", async () => {
    const { user, state, calls } = setup({ hash: fragment("a-dead-link") });

    await choose(user, NEW_PASSWORD);

    expect(await screen.findByText(REFUSED)).toBeInTheDocument();
    /*
     * The screen's own sentence, not the code map's: every sentence an app
     * has for `UNAUTHENTICATED` is about a session that ended, which is false
     * in every word here — the reader is anonymous, nothing of theirs has
     * ended, and signing in is exactly what they cannot do. The harness's map
     * answers its fallback for that code, so its absence is the assertion.
     */
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByText(APP_COPY.errors.fallback),
    ).not.toBeInTheDocument();

    // The way forward is the link the app passed, drawn where the form was.
    expect(
      screen.getByRole("link", { name: "Ask for a new link" }),
    ).toHaveAttribute("href", "/forgot-password");
    // And the form is gone: no password would make that token work.
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();

    expect(state.resetPasswordCalls).toEqual([
      { token: "a-dead-link", newPassword: NEW_PASSWORD },
    ]);
    expect(calls.toSignIn).toBe(0);
  });

  it("says the same thing when the address carries no link at all", () => {
    const { state, calls } = setup({ hash: "" });

    /*
     * Nothing in either app sends anybody here empty-handed, so the only way
     * to arrive without a fragment is a link that has lost one — the same
     * predicament as a link that has been spent, and the same sentence rather
     * than an invented distinction.
     */
    expect(screen.getByText(REFUSED)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Ask for a new link" }),
    ).toHaveAttribute("href", "/forgot-password");
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();

    expect(state.resetPasswordCalls).toEqual([]);
    // Nothing to strike, so nothing is navigated.
    expect(calls.strikeToken).toBe(0);
  });

  it("treats an empty token as no link", () => {
    const { calls } = setup({ hash: "token=" });

    expect(screen.getByText(REFUSED)).toBeInTheDocument();
    expect(calls.strikeToken).toBe(0);
  });

  it("holds the link back from a password the policy refuses", async () => {
    const { user, state } = setup();

    await choose(user, "short");

    /*
     * `resetPasswordBody` is the object the API validates with (ADR-0011,
     * ADR-0023), so the rule is the rule — and the request never leaves,
     * because the endpoint carries the login limiter's argon2 budget
     * (ADR-0071 §4 as amended) and a body the schema refuses would spend it.
     *
     * The positive assertion first, so the case cannot pass by the submit
     * handler never running at all (`D18.6`, `code-reviewer`). The sentence is
     * zod's own rather than a key anybody wrote, which is ADR-0046 §6's shape.
     */
    expect(
      await screen.findByText(/expected string to have >=12 characters/i),
    ).toBeInTheDocument();

    expect(state.resetPasswordCalls).toEqual([]);
    // Still the form, and still holding the link: a bad password is something
    // the person can fix by typing a better one.
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
    expect(screen.queryByText(REFUSED)).not.toBeInTheDocument();

    // Which they then do, and the held link is spent on it.
    await user.clear(screen.getByLabelText("New password"));
    await choose(user, NEW_PASSWORD);

    await waitFor(() => {
      expect(state.resetPasswordCalls).toEqual([
        { token: RESET_TOKEN, newPassword: NEW_PASSWORD },
      ]);
    });
    expect(
      screen.queryByText(/expected string to have >=12 characters/i),
    ).not.toBeInTheDocument();
  });

  it("leaves the form standing on a 429, in the app's own words", async () => {
    /*
     * Every refusal that is not the link's own comes through the code map the
     * door passes (ADR-0034, ADR-0077 §2) — the submit budget's `429` above
     * all, because trying again in a moment is exactly the right thing to do.
     * The harness's catalogue is worded like neither app's, so reading it here
     * can only mean the dependency was used.
     */
    const { user, state, calls } = setup({
      script: { resetFailsWith: { status: 429, code: "RATE_LIMITED" } },
    });

    await choose(user, NEW_PASSWORD);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      APP_COPY.errors.RATE_LIMITED,
    );
    expect(screen.queryByText(REFUSED)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save the new password" }),
    ).toBeEnabled();
    expect(calls.toSignIn).toBe(0);

    // The link is still held: the same token goes out again once the budget
    // lets it, and this time it is taken.
    state.resetFailsWith = undefined;
    await user.click(
      screen.getByRole("button", { name: "Save the new password" }),
    );

    await waitFor(() => {
      expect(calls.toSignIn).toBe(1);
    });
    expect(state.resetPasswordCalls).toEqual([
      { token: RESET_TOKEN, newPassword: NEW_PASSWORD },
      { token: RESET_TOKEN, newPassword: NEW_PASSWORD },
    ]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("takes a second link pasted into a tab that is showing the dead-link screen", async () => {
    /*
     * A fragment-only change reloads no document, so the screen that is
     * already mounted has to take the new link: hold it, strike it, and come
     * back from `refused`. A latch on the strike once made the second link
     * both unusable and un-struck (`D18.6`, `code-reviewer`).
     */
    const { user, state, address, calls } = setup({
      hash: fragment("a-dead-link"),
    });

    await choose(user, NEW_PASSWORD);
    expect(await screen.findByText(REFUSED)).toBeInTheDocument();
    expect(calls.strikeToken).toBe(1);

    act(() => {
      address.write(fragment(RESET_TOKEN));
    });

    // Struck like the first one was…
    await waitFor(() => {
      expect(address.read()).toBe("");
    });
    expect(calls.strikeToken).toBe(2);

    /*
     * …and the form is back, holding the new link and not the dead one. The
     * box is cleared first because the form component outlives its own
     * dead-link screen, and what was typed for the first link is still in it.
     */
    await user.clear(await screen.findByLabelText("New password"));
    await choose(user, NEW_PASSWORD);

    await waitFor(() => {
      expect(calls.toSignIn).toBe(1);
    });
    expect(state.resetPasswordCalls).toEqual([
      { token: "a-dead-link", newPassword: NEW_PASSWORD },
      { token: RESET_TOKEN, newPassword: NEW_PASSWORD },
    ]);
    expect(document.documentElement.innerHTML).not.toContain(RESET_TOKEN);
  });

  it("hands the form back when the landing on sign-in is cancelled", async () => {
    /*
     * A cancelled navigation would otherwise leave the form disabled for
     * good, because success is the one path that never clears `pending`
     * (`D18.6`, `security-reviewer`'s residual list). The link is spent either
     * way, so what is left standing is a form somebody can read.
     */
    const { user, state, calls } = setup({ signInIsCancelled: true });

    await choose(user, NEW_PASSWORD);

    await waitFor(() => {
      expect(calls.toSignIn).toBe(1);
    });
    expect(
      await screen.findByRole("button", { name: "Save the new password" }),
    ).toBeEnabled();
    expect(screen.getByLabelText("New password")).toBeEnabled();

    // Spent is spent: pressing again offers the API nothing, and says so.
    await user.click(
      screen.getByRole("button", { name: "Save the new password" }),
    );

    expect(await screen.findByText(REFUSED)).toBeInTheDocument();
    expect(state.resetPasswordCalls).toHaveLength(1);
  });
});

describe("the hook, without the form", () => {
  it("refuses to spend when it holds nothing, and asks the API nothing", async () => {
    /*
     * The form cannot reach this: with no link it renders no button. The
     * hook's own guard is what stands between a caller that renders one
     * anyway and a request carrying no credential.
     */
    const { recovery, state, calls } = bind({ hash: "" });
    const { useResetPassword } = recovery;

    const Probe = () => {
      const { status, pending, submit } = useResetPassword();

      return (
        <button
          disabled={pending}
          onClick={() => {
            submit(NEW_PASSWORD);
          }}
          type="button"
        >
          {status}
        </button>
      );
    };

    const user = userEvent.setup();

    renderAccount(<Probe />);

    await user.click(screen.getByRole("button", { name: "refused" }));

    expect(screen.getByRole("button", { name: "refused" })).toBeEnabled();
    expect(state.resetPasswordCalls).toEqual([]);
    expect(calls).toEqual({ strikeToken: 0, toSignIn: 0 });
  });
});

describe("the outcome sentence an app may pass", () => {
  /*
   * ADR-0072 §4: the customer app says on the sign-in screen that the
   * password is saved and Google may have been unlinked; the admin lands in
   * silence. The sentence is delivered by ADR-0034's global handler from
   * `meta.success`, which lives in the kit — so what this package owes is the
   * `meta`, and the toast itself is asserted at the customer's door.
   */
  const OUTCOME: TranslationKey = "app:outcome";

  it("names the key as the mutation's success when one is passed", async () => {
    const { queryClient, metas } = createWatchedClient();
    const { user, calls } = setup({ outcome: OUTCOME, queryClient });

    await choose(user, NEW_PASSWORD);

    await waitFor(() => {
      expect(calls.toSignIn).toBe(1);
    });
    expect(metas).toStrictEqual([{ errorToast: false, success: OUTCOME }]);
  });

  it("sends the client's own call, through no mutation, when none is passed", async () => {
    /*
     * The admin's path, kept as it was: with no sentence to deliver there is
     * no mutation to carry one, so the global handler is never asked and the
     * request does not wait on the query client's network mode.
     */
    const { queryClient, metas } = createWatchedClient();
    const { user, state, calls } = setup({ queryClient });

    await choose(user, NEW_PASSWORD);

    await waitFor(() => {
      expect(calls.toSignIn).toBe(1);
    });
    expect(state.resetPasswordCalls).toHaveLength(1);
    expect(metas).toStrictEqual([]);
    expect(queryClient.getMutationCache().getAll()).toEqual([]);
  });

  it("keeps the screen's refusals its own whether or not there is an outcome", async () => {
    /*
     * `errorToast: false` on both shapes: a dead link already has a screen,
     * and the global handler's toast beside it would say the code map's
     * sentence about a session — the one the screen exists not to say.
     */
    const { queryClient, metas } = createWatchedClient();
    const { user } = setup({
      outcome: OUTCOME,
      hash: fragment("a-dead-link"),
      queryClient,
    });

    await choose(user, NEW_PASSWORD);

    expect(await screen.findByText(REFUSED)).toBeInTheDocument();
    expect(metas).toStrictEqual([{ errorToast: false, success: OUTCOME }]);
  });
});
