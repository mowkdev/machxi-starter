import { useRouterState, type HistoryState } from "@tanstack/react-router";

/**
 * The address the confirmation screen is waiting on, as history state
 * (ADR-0071 §3; ADR-0044's split, which `@repo/grid`'s record navigation
 * writes down: **the URL owns view state, history state owns the way here**).
 *
 * Two screens send a person to `/verify-email` already knowing which mailbox
 * is being waited on — the sign-up form, which has just created the account,
 * and the sign-in form, which was refused with `AUTH_EMAIL_UNVERIFIED` for an
 * address somebody typed a second ago. Both hand it over so the resend control
 * is filled in rather than asking for it again.
 *
 * **Not a search param, and that is the decision.** An address in the query
 * string is an address in the browser's history, in whatever a screen-share is
 * showing, and — the moment anything on the page ever loads a third-party
 * asset — in a `Referer`. It is also shareable, which is the wrong property
 * for something that is one navigation's memory rather than a location. The
 * screen works with nothing at all: the resend control simply starts empty,
 * which is what a cold link to the address gets.
 *
 * Nothing here is trusted for anything. The value only prefills a field the
 * person can edit, and the endpoint it ends up at answers `202` for every
 * address whether one exists or not (ADR-0020 §Enumeration), so a forged
 * history entry buys nothing that typing the same address would not.
 */
declare module "@tanstack/react-router" {
  /**
   * Typed rather than indexed, for the reason `@repo/grid` gives for `list`:
   * a stringly-typed guess at every call site is the thing an augmentation
   * exists to remove. Optional, because every other navigation in this app
   * carries no address.
   */
  interface HistoryState {
    awaitingVerification?: { readonly email: string };
  }
}

/**
 * What a navigation to `/verify-email` spreads into its `state`.
 *
 * A function rather than an object literal at two call sites, so the key is
 * spelled once and the shape cannot drift between the form that writes it and
 * the hook that reads it.
 */
export const awaitingVerification = (
  email: string,
): HistoryState & {
  readonly awaitingVerification: { readonly email: string };
} => ({
  awaitingVerification: { email },
});

/**
 * The address to start the resend control with, or `""` for a cold arrival.
 *
 * `""` rather than `undefined`, because the consumer is a controlled input and
 * "no address" and "an empty box" are the same state on this screen.
 */
export const useAwaitedAddress = (): string =>
  useRouterState({
    select: (state) => state.location.state.awaitingVerification?.email ?? "",
  });
