import type {
  AcceptedResource,
  ForgotPasswordBody,
  ResetPasswordBody,
} from "@repo/contracts";

import type { FlowDeps } from "./deps";

/**
 * Password recovery (ADR-0071 §4).
 *
 * Split out of `client.ts` at `D20.7`, verbatim. The pair are together because
 * they are one flow in two requests, and they are the first in this package
 * that need no `baseURL` override: `forgot` and `reset` are mounted beside
 * each segment's own `login`, so the route is the population and no field in
 * the body names one.
 */
export const createRecoveryFlows = ({ instance, endSession }: FlowDeps) => {
  /**
   * Asks for a password-recovery link (ADR-0071 §4).
   *
   * **On this client's own segment, and that is the whole of the population
   * rule.** The route is `/{admin,user}/auth/password/forgot`, beside the
   * segment's `login`, so a staff address asked for on the customer client is
   * answered by the customer segment and mails nothing — no field in the body
   * names a population, and none can, because a field a caller controls is a
   * field a caller can disagree with the route about. This is the first pair
   * in this file that needs no `baseURL` override for exactly that reason.
   *
   * It writes nothing to the store and answers `202` for every address, known
   * or not (ADR-0020 §Enumeration), so there is no resource to hand to the
   * wrong client and nothing here to branch on. The locale travels in the body
   * because the answer must not depend on whether the address has an account
   * whose stored locale could be read (ADR-0071 §2, §4).
   */
  const forgotPassword = async (body: ForgotPasswordBody): Promise<void> => {
    await instance.post<{ data: AcceptedResource }>(
      "/auth/password/forgot",
      body,
    );
  };

  /**
   * Spends a recovery link on a new password (ADR-0071 §4).
   *
   * **It starts no session, and that is the decision rather than an omission.**
   * `verify-email` answers login's body because the person has just proven the
   * address; this answers `204` because the link proved the *mailbox* and not
   * the device, and signing in with the password they have just chosen is one
   * step away.
   *
   * **What it does do is end the session this browser already had**, and that
   * is the other half of the same decision (`D18.6`, `security-reviewer`).
   * "Writes nothing" is not the same as "leaves nothing": the endpoint revokes
   * every session of the account, this browser's included, so a client that
   * only declined to *write* would sit on an access token and a principal the
   * server has just killed — and the recovery screen's landing on `/login`
   * would then be bounced straight back by the `_auth` layout's
   * authenticated-visitor guard, onto a dashboard rendering cached state until
   * the next request meets a terminal code. The clear is unconditional because
   * this client cannot know whether the link belonged to the account currently
   * signed in — the answer carries no principal, by design — and forgetting a
   * bystander account's *memory* is strictly better than keeping a revoked
   * one: its refresh cookie is untouched, so a reload restores it.
   *
   * Every way it can fail answers one indistinguishable `401` (ADR-0071 §4),
   * so there is nothing to branch on here either; the screen says the link
   * cannot be used and offers another. Nothing is cleared on that path — a
   * refused link says nothing about anybody's session.
   */
  const resetPassword = async (body: ResetPasswordBody): Promise<void> => {
    await instance.post("/auth/password/reset", body);

    endSession();
  };

  return { forgotPassword, resetPassword } as const;
};
