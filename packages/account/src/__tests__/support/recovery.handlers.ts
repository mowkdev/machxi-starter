import type { ApiSegment } from "@repo/api-client";
import {
  forgotPasswordBody,
  resetPasswordBody,
  type ErrorCode,
  type ForgotPasswordBody,
  type ResetPasswordBody,
} from "@repo/contracts";
import { http, type HttpHandler } from "msw";

import { apiBase, fail, ok } from "./render";

/**
 * The two recovery endpoints, as MSW answers them for the package's own suite
 * (`D22.2`, ADR-0077 §4, ADR-0036 §The load-bearing rule).
 *
 * The apps' `auth.handlers.ts` pair, reduced to the two requests this package
 * makes. Bodies are parsed with the schemas the API validates with, so a
 * request the server would refuse throws here rather than being quietly
 * accepted by the mock.
 *
 * `createRecoveryHandlers(state, segment)` with no shared module state: the
 * handlers are mounted on **one** segment, so a request that went to the other
 * one meets `onUnhandledRequest: "error"` rather than an answer.
 */

/** The recovery link's token, as the mailed link would carry it. */
export const RESET_TOKEN = "reset-token-from-the-fragment";

/** A refusal a test scripts in place of the endpoint's ordinary answer. */
export interface ScriptedRefusal {
  readonly status: number;
  readonly code: ErrorCode;
}

export interface RecoveryMockState {
  /**
   * The bodies `POST /auth/password/forgot` has been offered. Bodies rather
   * than a count, because the address and the locale are both the point and
   * the *answer* is not: the endpoint says `202` whatever it is handed
   * (ADR-0020 §Enumeration).
   */
  forgotPasswordCalls: ForgotPasswordBody[];
  /**
   * The bodies `POST /auth/password/reset` has been offered. The token as well
   * as the password, because the token is what the screen had to carry out of
   * the fragment without rendering, storing or mangling it.
   */
  resetPasswordCalls: ResetPasswordBody[];
  /** When set, `forgot` answers this instead of `202` — a budget's `429`. */
  forgotFailsWith?: ScriptedRefusal | undefined;
  /** When set, `reset` answers this whatever the token — a budget's `429`. */
  resetFailsWith?: ScriptedRefusal | undefined;
}

export const createRecoveryMockState = (): RecoveryMockState => ({
  forgotPasswordCalls: [],
  resetPasswordCalls: [],
});

export const createRecoveryHandlers = (
  state: RecoveryMockState,
  segment: ApiSegment = "user",
) =>
  [
    /*
     * `202 { accepted: true }` for **every** address, because the answer must
     * not be an oracle (ADR-0020 §Enumeration). A mock that refused a
     * stranger's address would let the form render a distinction the API
     * refuses to make.
     */
    http.post(
      `${apiBase(segment)}/auth/password/forgot`,
      async ({ request }): Promise<Response> => {
        const body = forgotPasswordBody.parse(await request.json());

        state.forgotPasswordCalls.push(body);

        if (state.forgotFailsWith) {
          return fail(state.forgotFailsWith.status, state.forgotFailsWith.code);
        }

        return ok({ accepted: true }, 202);
      },
    ),

    /*
     * **`204` and no session**, and **one indistinguishable `401` for every
     * refusal of the link** — unknown, consumed, expired, or minted on the
     * other segment (ADR-0071 §4).
     */
    http.post(
      `${apiBase(segment)}/auth/password/reset`,
      async ({ request }): Promise<Response> => {
        const body = resetPasswordBody.parse(await request.json());

        state.resetPasswordCalls.push(body);

        if (state.resetFailsWith) {
          return fail(state.resetFailsWith.status, state.resetFailsWith.code);
        }

        if (body.token !== RESET_TOKEN) return fail(401, "UNAUTHENTICATED");

        return new Response(null, { status: 204 });
      },
    ),
  ] as const satisfies readonly HttpHandler[];
